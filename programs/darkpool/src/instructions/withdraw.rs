use anchor_lang::prelude::*;
use crate::error::DarkpoolError;
use crate::state::*;

/// Initiate a withdrawal. For Solana-native assets this settles immediately.
/// For cross-chain assets (BTC=1, ETH=2), an off-chain Ika node watches for
/// WithdrawalRequested events and triggers a dWallet threshold signature on
/// the destination chain.
pub fn handler(
    ctx: Context<Withdraw>,
    amount: u64,
    destination_chain: u8,
    destination_address: [u8; 64],
) -> Result<()> {
    let pool = &ctx.accounts.pool_state;
    require!(!pool.paused, DarkpoolError::PoolPaused);
    require!(destination_chain <= 3, DarkpoolError::InvalidDestinationChain);

    let vault = &ctx.accounts.trader_vault;
    require!(vault.owner == ctx.accounts.trader.key(), DarkpoolError::VaultOwnerMismatch);

    let clock = Clock::get()?;
    let request = &mut ctx.accounts.withdraw_request;
    request.owner = ctx.accounts.trader.key();
    request.vault = ctx.accounts.trader_vault.key();
    request.amount = amount;
    request.destination_chain = destination_chain;
    request.destination_address = destination_address;
    request.status = WithdrawStatus::Pending as u8;
    request.requested_at = clock.unix_timestamp;
    request.dwallet_id = vault.dwallet_id;
    request.bump = ctx.bumps.withdraw_request;

    emit!(WithdrawalRequested {
        owner: ctx.accounts.trader.key(),
        vault: ctx.accounts.trader_vault.key(),
        withdraw_request: ctx.accounts.withdraw_request.key(),
        amount,
        destination_chain,
        destination_address,
        dwallet_id: vault.dwallet_id,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(amount: u64, destination_chain: u8, destination_address: [u8; 64])]
pub struct Withdraw<'info> {
    #[account(seeds = [POOL_STATE_SEED], bump = pool_state.bump)]
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
        space = 8 + WithdrawRequest::INIT_SPACE,
        seeds = [WITHDRAW_REQUEST_SEED, trader.key().as_ref(), &destination_address[..32]],
        bump,
    )]
    pub withdraw_request: Account<'info, WithdrawRequest>,

    #[account(mut)]
    pub trader: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct WithdrawalRequested {
    pub owner: Pubkey,
    pub vault: Pubkey,
    pub withdraw_request: Pubkey,
    pub amount: u64,
    pub destination_chain: u8,
    pub destination_address: [u8; 64],
    pub dwallet_id: [u8; 32],
}
