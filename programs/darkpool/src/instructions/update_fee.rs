use anchor_lang::prelude::*;
use crate::error::DarkpoolError;
use crate::state::*;

pub fn handler(ctx: Context<UpdateFee>, new_fee_bps: u16) -> Result<()> {
    require!(new_fee_bps <= MAX_FEE_BPS, DarkpoolError::FeeTooHigh);
    ctx.accounts.pool_state.fee_bps = new_fee_bps;
    emit!(FeeUpdated { new_fee_bps });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateFee<'info> {
    #[account(
        mut,
        seeds = [POOL_STATE_SEED],
        bump = pool_state.bump,
        constraint = pool_state.admin == admin.key() @ DarkpoolError::Unauthorized,
    )]
    pub pool_state: Account<'info, PoolState>,
    pub admin: Signer<'info>,
}

#[event]
pub struct FeeUpdated {
    pub new_fee_bps: u16,
}
