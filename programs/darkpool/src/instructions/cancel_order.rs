use anchor_lang::prelude::*;
use crate::error::DarkpoolError;
use crate::state::*;

pub fn handler(ctx: Context<CancelOrder>) -> Result<()> {
    let order = &mut ctx.accounts.order;
    require!(
        order.status == OrderStatus::Open as u8,
        DarkpoolError::OrderNotOpen
    );
    require!(
        order.owner == ctx.accounts.trader.key(),
        DarkpoolError::Unauthorized
    );

    order.status = OrderStatus::Cancelled as u8;

    emit!(OrderCancelled {
        order: ctx.accounts.order.key(),
        owner: ctx.accounts.trader.key(),
    });

    Ok(())
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(
        mut,
        constraint = order.owner == trader.key() @ DarkpoolError::Unauthorized,
    )]
    pub order: Account<'info, Order>,

    pub trader: Signer<'info>,
}

#[event]
pub struct OrderCancelled {
    pub order: Pubkey,
    pub owner: Pubkey,
}
