/**
 * Constants for Counterparty protocol
 */

/**
 * Counterparty protocol prefix
 */
export const PREFIX = 'CNTRPRTY';
export const PREFIX_BYTES = Buffer.from(PREFIX, 'utf8');

/**
 * Message type IDs according to Counterparty protocol
 */
export const MESSAGE_TYPES: Record<number, string> = {
  2: 'enhanced_send',
  3: 'mpma_send',
  4: 'sweep',
  10: 'order',
  11: 'btc_pay',
  12: 'dispenser',
  13: 'dispense',
  20: 'issuance',
  21: 'issuance_subasset',
  22: 'issuance',
  23: 'issuance_subasset',
  30: 'broadcast',
  50: 'dividend',
  70: 'cancel',
  90: 'fairminter',
  91: 'fairmint',
  101: 'attach',
  102: 'detach',
  110: 'destroy',
};
