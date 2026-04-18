use anchor_lang::prelude::*;
use crate::error::DarkpoolError;
use crate::state::*;

pub fn handler(
    ctx: Context<Deposit>,
    encrypted_amount: [u8; 128],
    dwallet_id: [u8; 32],
    asset_type: u8,
) -> Result<()> {
    let pool = &ctx.accounts.pool_state;
    require!(!pool.paused, DarkpoolError::PoolPaused);
    require!(asset_type <= 3, DarkpoolError::InvalidAssetType);

    // Snapshot keys before mutable borrows to avoid borrow conflicts.
    let trader_key = ctx.accounts.trader.key();
    let vault_key = ctx.accounts.trader_vault.key();
    let trader_info = ctx.accounts.trader.to_account_info();
    let vault_info = ctx.accounts.trader_vault.to_account_info();

    // Transfer SOL fee reserve before taking mutable vault borrow.
    let fee_transfer = anchor_lang::solana_program::system_instruction::transfer(
        &trader_key,
        &vault_key,
        MIN_FEE_RESERVE_LAMPORTS,
    );
    anchor_lang::solana_program::program::invoke(
        &fee_transfer,
        &[trader_info, vault_info],
    )?;

    let vault = &mut ctx.accounts.trader_vault;

    // First deposit: initialize fields.
    if vault.deposit_count == 0 {
        vault.owner = trader_key;
        vault.asset_type = asset_type;
        vault.dwallet_id = dwallet_id;
        vault.bump = ctx.bumps.trader_vault;
    }

    // Update encrypted balance with new ciphertext from client.
    // (client runs FHE addition: new_ciphertext = Enc(old_balance + deposit))
    vault.encrypted_balance = encrypted_amount;
    vault.deposit_count = vault.deposit_count.saturating_add(1);
    vault.fee_reserve_lamports = vault
        .fee_reserve_lamports
        .checked_add(MIN_FEE_RESERVE_LAMPORTS)
        .ok_or(DarkpoolError::Overflow)?;

    emit!(Deposited {
        trader: trader_key,
        vault: vault_key,
        dwallet_id,
        asset_type,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(seeds = [POOL_STATE_SEED], bump = pool_state.bump)]
    pub pool_state: Account<'info, PoolState>,

    #[account(
        init_if_needed,
        payer = trader,
        space = 8 + TraderVault::INIT_SPACE,
        seeds = [TRADER_VAULT_SEED, trader.key().as_ref()],
        bump,
    )]
    pub trader_vault: Account<'info, TraderVault>,

    #[account(mut)]
    pub trader: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct Deposited {
    pub trader: Pubkey,
    pub vault: Pubkey,
    pub dwallet_id: [u8; 32],
    pub asset_type: u8,
}
