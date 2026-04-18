use anchor_lang::prelude::*;
use crate::error::DarkpoolError;
use crate::state::*;

pub fn handler(
    ctx: Context<PlaceOrder>,
    encrypted_price: [u8; 128],
    encrypted_size: [u8; 128],
    order_commitment: [u8; 32],
    order_type: u8,
    expiry: i64,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool_state;
    require!(!pool.paused, DarkpoolError::PoolPaused);
    require!(order_type <= 1, DarkpoolError::InvalidOrderType);

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    require!(expiry > now, DarkpoolError::OrderExpired);
    require!(
        expiry - now <= MAX_ORDER_EXPIRY_SECS,
        DarkpoolError::ExpiryTooLong
    );

    let vault = &ctx.accounts.trader_vault;
    require!(vault.owner == ctx.accounts.trader.key(), DarkpoolError::VaultOwnerMismatch);
    require!(
        vault.fee_reserve_lamports >= MIN_FEE_RESERVE_LAMPORTS,
        DarkpoolError::InsufficientFeeReserve
    );

    // Snapshot keys before mutable borrows.
    let order_key = ctx.accounts.order.key();
    let trader_key = ctx.accounts.trader.key();
    let vault_key = ctx.accounts.trader_vault.key();

    let order = &mut ctx.accounts.order;
    order.owner = trader_key;
    order.vault = vault_key;
    order.encrypted_price = encrypted_price;
    order.encrypted_size = encrypted_size;
    order.order_commitment = order_commitment;
    order.order_type = order_type;
    order.status = OrderStatus::Open as u8;
    order.created_at = now;
    order.expiry = expiry;
    order.sequence = pool.total_orders;
    order.bump = ctx.bumps.order;

    let sequence = order.sequence;
    pool.total_orders = pool.total_orders.checked_add(1).ok_or(DarkpoolError::Overflow)?;

    emit!(OrderPlaced {
        order: order_key,
        owner: trader_key,
        order_type,
        order_commitment,
        expiry,
        sequence,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(
    encrypted_price: [u8; 128],
    encrypted_size: [u8; 128],
    order_commitment: [u8; 32],
    order_type: u8,
    expiry: i64,
)]
pub struct PlaceOrder<'info> {
    #[account(mut, seeds = [POOL_STATE_SEED], bump = pool_state.bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(
        seeds = [TRADER_VAULT_SEED, trader.key().as_ref()],
        bump = trader_vault.bump,
        constraint = trader_vault.owner == trader.key() @ DarkpoolError::VaultOwnerMismatch,
    )]
    pub trader_vault: Account<'info, TraderVault>,

    #[account(
        init,
        payer = trader,
        space = 8 + Order::INIT_SPACE,
        seeds = [ORDER_SEED, trader.key().as_ref(), &order_commitment],
        bump,
    )]
    pub order: Account<'info, Order>,

    #[account(mut)]
    pub trader: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct OrderPlaced {
    pub order: Pubkey,
    pub owner: Pubkey,
    pub order_type: u8,
    pub order_commitment: [u8; 32],
    pub expiry: i64,
    pub sequence: u64,
}
