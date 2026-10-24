export interface ThesisFigure {
  file: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
}

/**
 * The four figures lifted from the thesis PDF. Dimensions are the committed
 * intrinsic sizes, so both the home section and the thesis gallery can set
 * width/height without a layout shift.
 */
export const THESIS_FIGURES: readonly ThesisFigure[] = [
  {
    file: "network.webp",
    width: 1400,
    height: 908,
    alt: "Network diagram: three organisation peers on one channel with a Raft orderer.",
    caption:
      "Three organisations on one channel, with a Raft orderer and a peer per organisation.",
  },
  {
    file: "cnas-register.webp",
    width: 990,
    height: 856,
    alt: "CNAS register screen with a member registration form and a ledger read.",
    caption: "The CNAS section: registering a member and reading the ledger.",
  },
  {
    file: "provider-prescribe.webp",
    width: 903,
    height: 854,
    alt: "Provider portal issuing a prescription for an eligible patient.",
    caption:
      "The provider portal issuing a prescription for an eligible patient.",
  },
  {
    file: "sequence.webp",
    width: 1400,
    height: 1213,
    alt: "Sequence diagram of prescription issuance, with ledger reads and endorsement by both parties.",
    caption:
      "Prescription issuance as a sequence: the contract reads the ledger, then both parties endorse.",
  },
] as const;
