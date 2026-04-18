use anchor_lang::prelude::*;
use crate::error::DarkpoolError;
use crate::state::*;

pub fn handler(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.pool_state.paused = paused;
    emit!(PauseStateChanged { paused });
    Ok(())
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
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
pub struct PauseStateChanged {
    pub paused: bool,
}
