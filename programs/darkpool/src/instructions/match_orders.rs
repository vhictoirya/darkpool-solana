use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use crate::error::DarkpoolError;
use crate::state::*;

/// Called by the Encrypt MPC matching engine.
///
/// Proof layout (256 bytes):
///   [0..32]   SHA-256(maker_commitment ∥ taker_commitment ∥ price_le8 ∥ size_le8)
///   [32..64]  maker order_commitment  (for indexers / audit trail)
///   [64..96]  taker order_commitment  (for indexers / audit trail)
///   [96..256] reserved — threshold signature bytes when Encrypt mainnet ships
///
/// Two properties are enforced on-chain:
///   1. Authority: matcher must be the registered encrypt_mpc_authority.
///      Only the Encrypt MPC quorum key can settle trades.
///   2. Integrity: proof[0..32] must equal SHA-256 of the settlement tuple.
///      Forgery requires either breaking SHA-256 or compromising the MPC key.
pub fn handler(
    ctx: Context<MatchOrders>,
    match_proof: Vec<u8>,
    settled_price: u64,
    settled_size: u64,
) -> Result<()> {
    require!(match_proof.len() == 256, DarkpoolError::InvalidMatchProof);

    let pool = &mut ctx.accounts.pool_state;
    require!(!pool.paused, DarkpoolError::PoolPaused);

    // ── Authority check ───────────────────────────────────────────────────────
    // Only the registered Encrypt MPC aggregator key may settle matches.
    require!(
        ctx.accounts.matcher.key() == pool.encrypt_mpc_authority,
        DarkpoolError::Unauthorized
    );

    // ── Order state checks ────────────────────────────────────────────────────
    require!(
        ctx.accounts.maker_order.status == OrderStatus::Open as u8,
        DarkpoolError::OrderNotOpen
    );
    require!(
        ctx.accounts.taker_order.status == OrderStatus::Open as u8,
        DarkpoolError::OrderNotOpen
    );
    require!(
        ctx.accounts.maker_order.owner != ctx.accounts.taker_order.owner,
        DarkpoolError::SelfTrade
    );
    require!(
        ctx.accounts.maker_order.order_type == OrderType::Bid as u8,
        DarkpoolError::InvalidOrderType
    );
    require!(
        ctx.accounts.taker_order.order_type == OrderType::Ask as u8,
        DarkpoolError::InvalidOrderType
    );

    // ── Expiry checks ─────────────────────────────────────────────────────────
    let clock = Clock::get()?;
    require!(
        ctx.accounts.maker_order.expiry >= clock.unix_timestamp,
        DarkpoolError::OrderExpired
    );
    require!(
        ctx.accounts.taker_order.expiry >= clock.unix_timestamp,
        DarkpoolError::OrderExpired
    );

    // ── Settlement hash verification ──────────────────────────────────────────
    // The Encrypt MPC network produces SHA-256(maker_c ∥ taker_c ∥ price ∥ size)
    // and embeds it at proof[0..32]. This binds the proof to the exact settlement
    // values — a different price or size produces a different hash and is rejected.
    let settlement_hash = hashv(&[
        &ctx.accounts.maker_order.order_commitment,
        &ctx.accounts.taker_order.order_commitment,
        &settled_price.to_le_bytes(),
        &settled_size.to_le_bytes(),
    ]);
    require!(
        match_proof[0..32] == settlement_hash.to_bytes(),
        DarkpoolError::InvalidMatchProof
    );

    // ── Commitment binding (indexer / audit) ──────────────────────────────────
    require!(
        match_proof[32..64] == ctx.accounts.maker_order.order_commitment,
        DarkpoolError::InvalidMatchProof
    );
    require!(
        match_proof[64..96] == ctx.accounts.taker_order.order_commitment,
        DarkpoolError::InvalidMatchProof
    );

    // ── Fee calculation ───────────────────────────────────────────────────────
    let fee = (settled_price as u128)
        .checked_mul(settled_size as u128)
        .ok_or(DarkpoolError::Overflow)?
        .checked_mul(pool.fee_bps as u128)
        .ok_or(DarkpoolError::Overflow)?
        .checked_div(10_000)
        .ok_or(DarkpoolError::Overflow)?
        .checked_div(1_000_000)
        .ok_or(DarkpoolError::Overflow)? as u64;

    // Snapshot keys before mutable borrows.
    let maker_key      = ctx.accounts.maker_order.key();
    let taker_key      = ctx.accounts.taker_order.key();
    let maker_owner    = ctx.accounts.maker_order.owner;
    let taker_owner    = ctx.accounts.taker_order.owner;
    let settlement_key = ctx.accounts.settlement.key();

    let mut proof_arr = [0u8; 256];
    proof_arr.copy_from_slice(&match_proof);

    ctx.accounts.maker_order.status = OrderStatus::Matched as u8;
    ctx.accounts.taker_order.status = OrderStatus::Matched as u8;

    pool.total_orders = pool
        .total_orders
        .checked_add(1)
        .ok_or(DarkpoolError::Overflow)?;

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
        settlement_key, maker_owner, taker_owner, settled_price, settled_size, fee,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct MatchOrders<'info> {
    #[account(mut, seeds = [b"pool_state"], bump = pool_state.bump)]
    pub pool_state: Account<'info, PoolState>,

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

    /// The Encrypt MPC authority — must equal pool_state.encrypt_mpc_authority.
    #[account(mut)]
    pub matcher: Signer<'info>,

    pub system_program: Program<'info, System>,
}
