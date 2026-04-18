use anchor_lang::prelude::*;
use crate::error::DarkpoolError;
use crate::state::*;

/// Called by the off-chain MPC matching engine.
///
/// Proof layout (256 bytes):
///   [0..32]   maker order_commitment
///   [32..64]  taker order_commitment
///   [64..256] MPC node threshold signatures (placeholder; verify off-chain in SDK)
///
/// In production, the on-chain verifier would check an ed25519 multi-sig from
/// the Encrypt MPC quorum. For the initial testnet, the matcher keypair is
/// an admin-controlled relayer that the pool trusts.
pub fn handler(
    ctx: Context<MatchOrders>,
    match_proof: Vec<u8>,   // Vec = heap-allocated; avoids 4096-byte SBF stack limit
    settled_price: u64,
    settled_size: u64,
) -> Result<()> {
    require!(match_proof.len() == 256, DarkpoolError::InvalidMatchProof);

    let pool = &mut ctx.accounts.pool_state;
    require!(!pool.paused, DarkpoolError::PoolPaused);

    // Both orders must be open.
    require!(
        ctx.accounts.maker_order.status == OrderStatus::Open as u8,
        DarkpoolError::OrderNotOpen
    );
    require!(
        ctx.accounts.taker_order.status == OrderStatus::Open as u8,
        DarkpoolError::OrderNotOpen
    );

    // No self-trade.
    require!(
        ctx.accounts.maker_order.owner != ctx.accounts.taker_order.owner,
        DarkpoolError::SelfTrade
    );

    // Direction check: maker=bid (0), taker=ask (1).
    require!(
        ctx.accounts.maker_order.order_type == OrderType::Bid as u8,
        DarkpoolError::InvalidOrderType
    );
    require!(
        ctx.accounts.taker_order.order_type == OrderType::Ask as u8,
        DarkpoolError::InvalidOrderType
    );

    // Verify proof embeds both order commitments.
    require!(
        match_proof[0..32] == ctx.accounts.maker_order.order_commitment,
        DarkpoolError::InvalidMatchProof
    );
    require!(
        match_proof[32..64] == ctx.accounts.taker_order.order_commitment,
        DarkpoolError::InvalidMatchProof
    );

    // Expiry checks.
    let clock = Clock::get()?;
    require!(
        ctx.accounts.maker_order.expiry >= clock.unix_timestamp,
        DarkpoolError::OrderExpired
    );
    require!(
        ctx.accounts.taker_order.expiry >= clock.unix_timestamp,
        DarkpoolError::OrderExpired
    );

    // Fee calculation.
    let fee = (settled_price as u128)
        .checked_mul(settled_size as u128)
        .ok_or(DarkpoolError::Overflow)?
        .checked_mul(pool.fee_bps as u128)
        .ok_or(DarkpoolError::Overflow)?
        .checked_div(10_000)
        .ok_or(DarkpoolError::Overflow)?
        .checked_div(1_000_000)
        .ok_or(DarkpoolError::Overflow)? as u64;

    // Snapshot before mutable borrows.
    let maker_key      = ctx.accounts.maker_order.key();
    let taker_key      = ctx.accounts.taker_order.key();
    let maker_owner    = ctx.accounts.maker_order.owner;
    let taker_owner    = ctx.accounts.taker_order.owner;
    let settlement_key = ctx.accounts.settlement.key();

    // Copy Vec proof into fixed-size array for storage.
    let mut proof_arr = [0u8; 256];
    proof_arr.copy_from_slice(&match_proof);

    // Mark orders matched.
    ctx.accounts.maker_order.status = OrderStatus::Matched as u8;
    ctx.accounts.taker_order.status = OrderStatus::Matched as u8;

    pool.total_orders = pool
        .total_orders
        .checked_add(1)
        .ok_or(DarkpoolError::Overflow)?;

    // Write settlement record.
    let settlement = &mut ctx.accounts.settlement;
    settlement.maker_order   = maker_key;
    settlement.taker_order   = taker_key;
    settlement.maker         = maker_owner;
    settlement.taker         = taker_owner;
    settlement.match_proof   = proof_arr;
    settlement.settled_price = settled_price;
    settlement.settled_size  = settled_size;
    settlement.fee_collected = fee;
    settlement.settled_at    = clock.unix_timestamp;
    settlement.bump          = ctx.bumps.settlement;

   msg!(
        "matched: settlement={} maker={} taker={} price={} size={} fee={}",
        settlement_key,
        maker_owner,
        taker_owner,
        settled_price,
        settled_size,
        fee,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct MatchOrders<'info> {
    #[account(mut, seeds = [b"pool_state"], bump = pool_state.bump)]
    pub pool_state: Account<'info, PoolState>,

    /// Box<> moves Order deserialization off the stack onto the heap —
    /// each Order holds 256 bytes of ciphertexts; without Box the frame
    /// exceeds the 4096-byte SBF limit.
    #[account(mut)]
    pub maker_order: Box<Account<'info, Order>>,

    #[account(mut)]
    pub taker_order: Box<Account<'info, Order>>,

    #[account(
        init,
        payer = matcher,
        space = 8 + Settlement::INIT_SPACE,
        seeds = [b"settlement", maker_order.key().as_ref(), taker_order.key().as_ref()],
        bump,
    )]
    pub settlement: Account<'info, Settlement>,

    #[account(mut)]
    pub matcher: Signer<'info>,

    pub system_program: Program<'info, System>,
}