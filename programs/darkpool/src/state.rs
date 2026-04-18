use anchor_lang::prelude::*;

/// Global protocol configuration. One PDA per deployment.
#[account]
#[derive(InitSpace)]
pub struct PoolState {
    pub admin: Pubkey,
    pub fee_bps: u16,
    pub paused: bool,
    pub total_orders: u64,
    pub total_volume_usd: u64,
    pub bump: u8,
}

/// Per-trader collateral vault tracking.
#[account]
#[derive(InitSpace)]
pub struct TraderVault {
    pub owner: Pubkey,
    /// FHE-encrypted balance ciphertext (Encrypt protocol).
    pub encrypted_balance: [u8; 128],
    /// Ika dWallet ID controlling cross-chain assets.
    pub dwallet_id: [u8; 32],
    pub asset_type: u8,
    /// Plaintext SOL/SPL balance for gas + fees.
    pub fee_reserve_lamports: u64,
    pub deposit_count: u32,
    pub bump: u8,
}

/// A single encrypted order in the pool.
#[account]
#[derive(InitSpace)]
pub struct Order {
    pub owner: Pubkey,
    pub vault: Pubkey,
    /// FHE-encrypted price (Encrypt ciphertext).
    pub encrypted_price: [u8; 128],
    /// FHE-encrypted size (Encrypt ciphertext).
    pub encrypted_size: [u8; 128],
    /// Pedersen commitment for ZK range proof of order validity.
    pub order_commitment: [u8; 32],
    pub order_type: u8,
    pub status: u8,
    pub created_at: i64,
    pub expiry: i64,
    pub sequence: u64,
    pub bump: u8,
}

/// Settlement record — written after a successful match.
#[account]
#[derive(InitSpace)]
pub struct Settlement {
    pub maker_order: Pubkey,
    pub taker_order: Pubkey,
    pub maker: Pubkey,
    pub taker: Pubkey,
    /// Match proof from the Encrypt MPC network.
    pub match_proof: [u8; 256],
    pub settled_price: u64,
    pub settled_size: u64,
    pub fee_collected: u64,
    pub settled_at: i64,
    pub bump: u8,
}

/// Withdrawal request — watched by Ika nodes for cross-chain release.
#[account]
#[derive(InitSpace)]
pub struct WithdrawRequest {
    pub owner: Pubkey,
    pub vault: Pubkey,
    pub amount: u64,
    pub destination_chain: u8,
    pub destination_address: [u8; 64],
    pub status: u8,
    pub requested_at: i64,
    pub dwallet_id: [u8; 32],
    pub bump: u8,
}

// ── Enums ────────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AssetType {
    Sol = 0,
    Btc = 1,
    Eth = 2,
    Usdc = 3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum OrderType {
    Bid = 0,
    Ask = 1,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum OrderStatus {
    Open = 0,
    Matched = 1,
    Cancelled = 2,
    Expired = 3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum WithdrawStatus {
    Pending = 0,
    Completed = 1,
    Failed = 2,
}

// ── Seeds ────────────────────────────────────────────────────────────────────

pub const POOL_STATE_SEED: &[u8] = b"pool_state";
pub const TRADER_VAULT_SEED: &[u8] = b"trader_vault";
pub const ORDER_SEED: &[u8] = b"order";
pub const SETTLEMENT_SEED: &[u8] = b"settlement";
pub const WITHDRAW_REQUEST_SEED: &[u8] = b"withdraw_request";

// ── Constants ────────────────────────────────────────────────────────────────

pub const MAX_FEE_BPS: u16 = 100; // 1% max
pub const MIN_FEE_RESERVE_LAMPORTS: u64 = 5_000_000; // 0.005 SOL
pub const MAX_ORDER_EXPIRY_SECS: i64 = 30 * 24 * 3600; // 30 days
pub const ENCRYPTED_CIPHERTEXT_LEN: usize = 128;
pub const MATCH_PROOF_LEN: usize = 256;
