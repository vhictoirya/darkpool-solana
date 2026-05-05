use anchor_lang::prelude::*;
use crate::error::DarkpoolError;
use crate::state::*;

pub fn handler(ctx: Context<Initialize>, fee_bps: u16, encrypt_mpc_authority: Pubkey) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, DarkpoolError::FeeTooHigh);

    let pool = &mut ctx.accounts.pool_state;
    pool.admin = ctx.accounts.admin.key();
    pool.encrypt_mpc_authority = encrypt_mpc_authority;
    pool.fee_bps = fee_bps;
    pool.paused = false;
    pool.total_orders = 0;
    pool.total_volume_usd = 0;
    pool.bump = ctx.bumps.pool_state;

    emit!(PoolInitialized {
        admin: pool.admin,
        encrypt_mpc_authority,
        fee_bps,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + PoolState::INIT_SPACE,
        seeds = [POOL_STATE_SEED],
        bump,
    )]
    pub pool_state: Account<'info, PoolState>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct PoolInitialized {
    pub admin: Pubkey,
    pub encrypt_mpc_authority: Pubkey,
    pub fee_bps: u16,
}
