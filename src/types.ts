/**
 * Type definitions for Counterparty transaction payloads
 */

/**
 * Enhanced Send (ID = 2)
 * CBOR array: [asset_id:uint64, quantity:int, short_address_bytes:21, memo:bytes]
 */
export interface EnhancedSendPayload {
  asset: string;
  quantity: string;
  address: string;
  memo: string;
}

/**
 * Sweep (ID = 4)
 * CBOR array: [short_address_bytes:21, flags:uint8, memo:bytes]
 */
export interface SweepPayload {
  address: string;
  flags: number;
  memo: string;
}

/**
 * Issuance (ID = 20, 22)
 * CBOR array: [asset_id:uint64, quantity:int, divisible:bool, lock:bool, reset:bool, mime_type:text, description:bytes|null]
 */
export interface IssuancePayload {
  asset: string;
  quantity: string;
  divisible: boolean;
  lock: boolean;
  reset: boolean;
  mime_type: string;
  description: string | null;
}

/**
 * Issuance Subasset (ID = 21, 23)
 * CBOR array: [asset_id:uint64, quantity:int, divisible:int(0|1), lock:int(0|1), reset:int(0|1), 
 *              compacted_subasset_length:int, compacted_subasset_longname:bytes, mime_type:text, description:bytes|null]
 */
export interface IssuanceSubassetPayload {
  asset: string;
  quantity: string;
  divisible: number;
  lock: number;
  reset: number;
  compacted_subasset_length: number;
  compacted_subasset_longname: string;
  mime_type: string;
  description: string | null;
}

/**
 * Broadcast (ID = 30)
 * CBOR array: [timestamp:int, value:float, fee_fraction_int:uint32, mime_type:text, text:bytes]
 */
export interface BroadcastPayload {
  timestamp: number;
  value: number;
  fee_fraction_int: number;
  mime_type: string;
  text: string;
}

/**
 * Fairminter (ID = 90)
 * CBOR array with multiple fields
 */
export interface FairminterPayload {
  asset: string;
  asset_parent: string;
  price: string;
  quantity_by_price: string;
  max_mint_per_tx: string;
  max_mint_per_address: string;
  hard_cap: string;
  premint_quantity: string;
  start_block: number;
  end_block: number;
  soft_cap: string;
  soft_cap_deadline_block: number;
  minted_asset_commission_int: number;
  burn_payment: boolean;
  lock_description: boolean;
  lock_quantity: boolean;
  divisible: boolean;
  mime_type: string;
  description: string;
}

/**
 * Fairmint (ID = 91)
 * CBOR array: [asset_id:uint64, quantity:int]
 */
export interface FairmintPayload {
  asset: string;
  quantity: string;
}

/**
 * Attach (ID = 101)
 * UTF-8 string format: "asset|quantity|destination_vout"
 */
export interface AttachPayload {
  asset: string;
  quantity: string;
  destination_vout: string;
}

/**
 * Detach (ID = 102)
 * UTF-8 address or single byte 0x30 (meaning "self")
 */
export interface DetachPayload {
  destination: string;
}

/**
 * Order (ID = 10)
 * Binary struct >QQQQHQ: [give_id:uint64, give_quantity:int64, get_id:uint64, get_quantity:int64, expiration:uint16, fee_required:int64]
 */
export interface OrderPayload {
  give_asset: string;
  give_quantity: string;
  get_asset: string;
  get_quantity: string;
  expiration: number;
  fee_required: string;
}

/**
 * BTC Pay (ID = 11)
 * Binary struct >32s32s: [tx0_hash:32 bytes, tx1_hash:32 bytes]
 */
export interface BtcPayPayload {
  tx0_hash: string;
  tx1_hash: string;
}

/**
 * Dispenser (ID = 12)
 * Binary struct >QQQQB: [asset_id:uint64, give_quantity:int64, escrow_quantity:int64, satoshirate:int64, status:uint8]
 * Optionally followed by action_address (21 bytes) and oracle_address (21 bytes)
 */
export interface DispenserPayload {
  asset: string;
  give_quantity: string;
  escrow_quantity: string;
  satoshirate: string;
  status: number;
  action_address?: string;
  oracle_address?: string;
}

/**
 * Dispense (ID = 13)
 * Minimal payload: 0x00 (single zero byte)
 */
export interface DispensePayload {
  data: string;
}

/**
 * Dividend (ID = 50)
 * Binary struct >QQQ or >QQ: [quantity_per_unit:int64, asset_id:uint64, dividend_asset_id:uint64 (optional)]
 */
export interface DividendPayload {
  quantity_per_unit: string;
  asset: string;
  dividend_asset: string;
}

/**
 * Cancel (ID = 70)
 * Binary struct >32s: [offer_hash:32 bytes]
 */
export interface CancelPayload {
  offer_hash: string;
}

/**
 * Destroy (ID = 110)
 * Binary struct >QQ: [asset_id:uint64, quantity:int64] + optional tag (up to 34 bytes)
 */
export interface DestroyPayload {
  asset: string;
  quantity: string;
  tag?: string;
}

/**
 * Unknown or failed decode payload
 */
export interface UnknownPayload {
  raw: string;
  error?: string;
}

/**
 * Taproot commit marker payload
 */
export interface TaprootCommitPayload {
  data: string;
}

/**
 * Union type of all possible payload types
 */
export type TransactionPayload =
  | EnhancedSendPayload
  | SweepPayload
  | IssuancePayload
  | IssuanceSubassetPayload
  | BroadcastPayload
  | FairminterPayload
  | FairmintPayload
  | AttachPayload
  | DetachPayload
  | OrderPayload
  | BtcPayPayload
  | DispenserPayload
  | DispensePayload
  | DividendPayload
  | CancelPayload
  | DestroyPayload
  | TaprootCommitPayload
  | UnknownPayload;

/**
 * Parsed transaction result
 */
export interface ParsedTransaction {
  message_name: string;
  message_id: number;
  params: TransactionPayload;
}

