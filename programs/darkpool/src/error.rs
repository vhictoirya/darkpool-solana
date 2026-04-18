use anchor_lang::prelude::*;

#[error_code]
pub enum DarkpoolError {
    #[msg("Pool is paused")]
    PoolPaused,
    #[msg("Unauthorized: signer is not admin")]
    Unauthorized,
    #[msg("Fee exceeds maximum of 100 bps")]
    FeeTooHigh,
    #[msg("Order has expired")]
    OrderExpired,
    #[msg("Order expiry is too far in the future")]
    ExpiryTooLong,
    #[msg("Order is not open")]
    OrderNotOpen,
    #[msg("Maker and taker cannot be the same account")]
    SelfTrade,
    #[msg("Invalid match proof")]
    InvalidMatchProof,
    #[msg("Invalid asset type")]
    InvalidAssetType,
    #[msg("Invalid order type")]
    InvalidOrderType,
    #[msg("Insufficient fee reserve")]
    InsufficientFeeReserve,
    #[msg("Invalid encrypted ciphertext length")]
    InvalidCiphertextLength,
    #[msg("Vault owner mismatch")]
    VaultOwnerMismatch,
    #[msg("Order vault mismatch")]
    OrderVaultMismatch,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Withdrawal amount exceeds available balance")]
    InsufficientBalance,
    #[msg("Invalid destination chain")]
    InvalidDestinationChain,
    #[msg("Withdrawal request already processed")]
    WithdrawAlreadyProcessed,
}
