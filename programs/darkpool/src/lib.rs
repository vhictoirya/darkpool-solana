use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("5GmUdA4PCUSGVggTFzFSc2K4n45D8aZ4YoSLTQf2s2x5");

#[program]
pub mod darkpool {
    use super::*;

    /// Initialize the global darkpool state (admin only, called once).
    pub fn initialize(ctx: Context<Initialize>, fee_bps: u16) -> Result<()> {
        instructions::initialize::handler(ctx, fee_bps)
    }

    /// Trader deposits collateral into an encrypted escrow vault.
    /// `encrypted_amount` is the FHE-encrypted deposit amount (Encrypt protocol ciphertext).
    /// `dwallet_id` is the Ika dWallet that controls cross-chain assets backing this deposit.
    pub fn deposit(
        ctx: Context<Deposit>,
        encrypted_amount: [u8; 128],
        dwallet_id: [u8; 32],
        asset_type: u8,
    ) -> Result<()> {
        instructions::deposit::handler(ctx, encrypted_amount, dwallet_id, asset_type)
    }

    /// Place an encrypted order into the dark pool.
    /// All order parameters are FHE-encrypted — price, size, and direction are hidden.
    /// `order_commitment` is a hash commitment for ZK proof of valid order params.
    pub fn place_order(
        ctx: Context<PlaceOrder>,
        encrypted_price: [u8; 128],
        encrypted_size: [u8; 128],
        order_commitment: [u8; 32],
        order_type: u8,
        expiry: i64,
    ) -> Result<()> {
        instructions::place_order::handler(
            ctx,
            encrypted_price,
            encrypted_size,
            order_commitment,
            order_type,
            expiry,
        )
    }

    /// Match two orders. Called by the off-chain MPC matching engine after
    /// computing an encrypted match proof. Both orders reveal nothing until
    /// this instruction confirms settlement.
    pub fn match_orders(
        ctx: Context<MatchOrders>,
        match_proof: Vec<u8>,
        settled_price: u64,
        settled_size: u64,
    ) -> Result<()> {
        instructions::match_orders::handler(ctx, match_proof, settled_price, settled_size)
    }

    /// Cancel an unmatched order. Signer must be the original order placer.
    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        instructions::cancel_order::handler(ctx)
    }

    /// Withdraw collateral from the pool.
    /// For cross-chain assets, emits an event that Ika nodes watch to trigger
    /// threshold signature on the originating chain.
    pub fn withdraw(
        ctx: Context<Withdraw>,
        amount: u64,
        destination_chain: u8,
        destination_address: [u8; 64],
    ) -> Result<()> {
        instructions::withdraw::handler(ctx, amount, destination_chain, destination_address)
    }

    /// Admin: update protocol fee.
    pub fn update_fee(ctx: Context<UpdateFee>, new_fee_bps: u16) -> Result<()> {
        instructions::update_fee::handler(ctx, new_fee_bps)
    }

    /// Admin: pause/unpause the pool.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::set_paused::handler(ctx, paused)
    }
}
