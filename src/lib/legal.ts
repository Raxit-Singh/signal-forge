// Who runs Heardex and how to reach them, for the legal pages (src/app/legal). One place to change.

export const LEGAL = {
  product: "Heardex",
  /** The person who operates Heardex (a sole proprietor; no registered company yet). */
  operator: "Raxit Singh",
  country: "India",
  /** Area and city shown on the Contact page (not a full street address); null hides the line. */
  address: "TP-13, Vadodara, Gujarat, India" as string | null,
  /** Must receive mail: customers and Dodo Payments use it. */
  email: "support@heardex.com",
  /** Business days to reply. */
  replyDays: 2,
  /** Days after the first payment of a new subscription in which it can be refunded in full. */
  refundDays: 14,
  updated: "18 November 2026",
} as const;

export const LEGAL_PAGES = [
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/refunds", label: "Refunds" },
  { href: "/legal/cookies", label: "Cookies" },
  { href: "/legal/contact", label: "Contact" },
] as const;
