/**
 * Non-Customer & Automated Email Classifier
 * Identifies and isolates OTPs, verification codes, sign-in/security alerts,
 * password resets, delivery failures, automated acknowledgments, newsletters,
 * and promotional notifications while strictly preserving genuine customer inquiries.
 */

export interface EmailClassificationInput {
  senderEmail: string;
  senderName?: string;
  subject: string;
  bodyText: string;
  headers?: Record<string, string> | Array<{ name: string; value: string }>;
  isAutomatedHeader?: boolean;
}

export interface EmailClassificationResult {
  isNonCustomer: boolean;
  reason?: string;
  category?:
    | 'otp_verification'
    | 'security_signin_alert'
    | 'password_reset'
    | 'delivery_failure_bounce'
    | 'automated_autoreply'
    | 'newsletter_marketing'
    | 'payment_transaction_alert'
    | 'system_notification'
    | 'self_sent';
}

const AUTOMATED_SENDER_PATTERNS = [
  /^mailer@shopify\.com$/i,
  /^accounts@shopify\.com$/i,
  /^(no-?reply|donotreply|do-not-reply|no_reply|notifications?|alerts?|mailer-daemon|postmaster|bounce|billing-noreply|news|newsletter|promotions?|marketing|updates?|system|security|auth|verify|daemon)@/i,
  /@(accounts\.shopify\.com|accounts\.google\.com|notifications\.google\.com|mail\.stripe\.com|stripe\.com)$/i,
  /@(nayapay\.com|sadapay\.pk|easypaisa\.com\.pk|jazzcash\.com\.pk|hbl\.com|bankalfalah\.com|meezanbank\.com|ubldigital\.com|mcb\.com\.pk|faysalbank\.com|sc\.com|raast\.pk)$/i,
  /^(service|services|support|transactions?|payments?|billing|statements?)@(nayapay\.com|sadapay\.pk|easypaisa\.com\.pk|jazzcash\.com\.pk)$/i,
];

const OTP_PATTERNS = [
  /\b(your\s*verification\s*code|one-?time\s*(password|code)|\botp\b\s*[:#-]?\s*\d{4,8})\b/i,
  /\b(use\s*this\s*(one\s*time\s*)?code\s*to\s*continue|this\s*code\s*expires\s*in\s*\d+\s*minutes?)\b/i,
  /\b(do\s*not\s*share\s*this\s*verification\s*code\s*with\s*anyone)\b/i,
  /\b(security\s*code\s*is\s*[:#-]?\s*\d{4,8}|verification\s*code\s*is\s*[:#-]?\s*\d{4,8})\b/i,
];

const SIGNIN_SECURITY_PATTERNS = [
  /\b(new\s*device\s*signed\s*in|new\s*sign-?in\s*(from|to|detected)|security\s*alert|suspicious\s*(sign-?in|activity))\b/i,
  /\b(we\s*noticed\s*a\s*new\s*sign-?in\s*to\s*your\s*account|if\s*this\s*was\s*you,\s*you'?re\s*all\s*set)\b/i,
  /\b(if\s*you\s*are\s*not\s*trying\s*to\s*log\s*in,\s*contact\s*support)\b/i,
  /\b(action\s*required:\s*review\s*(login|sign-?in|activity))\b/i,
  /\b(review\s*activity\s*\(?\s*https?:\/\/(accounts|login|security)\.)\b/i,
];

const PASSWORD_RESET_PATTERNS = [
  /\b(reset\s*your\s*password|password\s*reset\s*(request|link|instructions)|your\s*password\s*(has\s*been|was)\s*(changed|reset))\b/i,
  /\b(click\s*here\s*to\s*reset\s*your\s*password|requested\s*to\s*reset\s*the\s*password\s*for)\b/i,
];

const DELIVERY_FAILURE_PATTERNS = [
  /\b(delivery\s*status\s*notification\s*\(failure\)|undelivered\s*mail\s*returned|mail\s*delivery\s*failed|failure\s*notice|returned\s*mail|address\s*not\s*found)\b/i,
];

const AUTOREPLY_PATTERNS = [
  /^(auto-reply|automatic\s*reply|out\s*of\s*office|away\s*from\s*(the\s*)?office|vacation\s*auto-?reply)/i,
];

const NEWSLETTER_PROMO_PATTERNS = [
  /\b(view\s*in\s*browser|if\s*you\s*no\s*longer\s*wish\s*to\s*receive|unsubscribe\s*(from\s*this\s*list|here)?|manage\s*(your\s*)?email\s*preferences|opt-?out)\b/i,
];

const PAYMENT_TRANSACTION_PATTERNS = [
  /\b(you\s*(sent|got|received)|amount\s*(sent|received|transferred|debited|credited)|payment\s*(received|sent|successful|failed|declined)|transfer\s*successful|money\s*(sent|received|transfer)|funds\s*transfer|bill\s*payment|new\s*bill\s*from|bill\s*from|service\s*fee|transaction\s*alert|pos\s*transaction|debit\s*alert|credit\s*alert|atm\s*withdrawal|ibft\s*transfer|raast\s*transfer)\b/i,
  /\b(nayapay|sadapay|easypaisa|jazzcash|mobilink\s*mfb|1link|raast)\b/i,
  /\b(amount\s*details|service\s*fee\s*\(incl\.\s*tax\)|total\s*amount\s*transferred|transferred\s*via\s*raast)\b/i,
];

/**
 * Evaluates an incoming email to identify whether it is a non-customer automated notification.
 */
export function classifyEmailMessage(input: EmailClassificationInput): EmailClassificationResult {
  const { senderEmail = '', senderName = '', subject = '', bodyText = '', headers, isAutomatedHeader } = input;
  const cleanEmail = senderEmail.trim().toLowerCase();
  const cleanSubject = subject.trim();
  const combinedText = `${cleanSubject}\n${bodyText}`.trim();

  // Normalize headers map
  const headerMap: Record<string, string> = {};
  if (headers) {
    if (Array.isArray(headers)) {
      for (const h of headers) {
        headerMap[h.name.toLowerCase()] = h.value;
      }
    } else {
      for (const [k, v] of Object.entries(headers)) {
        headerMap[k.toLowerCase()] = v;
      }
    }
  }

  const autoSubmitted = headerMap['auto-submitted'] || '';
  const precedence = (headerMap['precedence'] || '').toLowerCase();
  const listUnsubscribe = headerMap['list-unsubscribe'] || '';
  const xAutoResponse = headerMap['x-auto-response-suppress'] || '';

  // 1. Check direct automated RFC headers
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') {
    return {
      isNonCustomer: true,
      category: 'system_notification',
      reason: `Automated email header detected: Auto-Submitted=${autoSubmitted}`,
    };
  }

  if (['bulk', 'list', 'junk', 'auto_reply'].includes(precedence)) {
    return {
      isNonCustomer: true,
      category: 'newsletter_marketing',
      reason: `Bulk/Automated delivery header detected: Precedence=${precedence}`,
    };
  }

  if (xAutoResponse && xAutoResponse.toLowerCase().includes('all')) {
    return {
      isNonCustomer: true,
      category: 'system_notification',
      reason: 'Automated suppression header detected: X-Auto-Response-Suppress',
    };
  }

  // 2. Check automated/bounce/service sender address
  const isAutomatedSender = AUTOMATED_SENDER_PATTERNS.some((p) => p.test(cleanEmail));

  // 3. Check Payment / Wallet / Banking Transaction Alerts (e.g. NayaPay, SadaPay, JazzCash, Easypaisa)
  const isFintechSender = /@(nayapay\.com|sadapay\.pk|easypaisa\.com\.pk|jazzcash\.com\.pk|hbl\.com|bankalfalah\.com|meezanbank\.com|ubldigital\.com|mcb\.com\.pk|faysalbank\.com|sc\.com|raast\.pk)$/i.test(cleanEmail) ||
    /^(service|services|support|transactions?|payments?|billing|statements?)@(nayapay\.com|sadapay\.pk|easypaisa\.com\.pk|jazzcash\.com\.pk)/i.test(cleanEmail);

  const hasPaymentTransactionContent = PAYMENT_TRANSACTION_PATTERNS.some((p) => p.test(combinedText));
  const hasPaymentSubject = /\b(you\s*(sent|got|received)|bill\s*from|payment\s*(received|sent|successful)|money\s*(sent|received|transfer)|amount\s*(sent|received))\b/i.test(cleanSubject);

  if (isFintechSender || (hasPaymentSubject && (isAutomatedSender || hasPaymentTransactionContent))) {
    return {
      isNonCustomer: true,
      category: 'payment_transaction_alert',
      reason: `Financial transaction alert, banking notification, or wallet transfer email (${cleanEmail}).`,
    };
  }

  // 4. Check Delivery Failure / Bounces
  if (DELIVERY_FAILURE_PATTERNS.some((p) => p.test(cleanSubject)) || cleanEmail.includes('mailer-daemon') || cleanEmail.includes('postmaster')) {
    return {
      isNonCustomer: true,
      category: 'delivery_failure_bounce',
      reason: 'Delivery failure or bounce notification.',
    };
  }

  // 5. Check Out of office / Auto-reply
  if (AUTOREPLY_PATTERNS.some((p) => p.test(cleanSubject))) {
    return {
      isNonCustomer: true,
      category: 'automated_autoreply',
      reason: 'Automated out-of-office or auto-reply notification.',
    };
  }

  // 6. Check OTP & Verification Codes (e.g. Shopify/Google/service OTPs)
  const hasOtpSubject = /\b(verification\s*code|one-?time\s*code|\botp\b|security\s*code)\b/i.test(cleanSubject);
  const hasOtpPattern = OTP_PATTERNS.some((p) => p.test(combinedText));
  if (hasOtpSubject || (hasOtpPattern && isAutomatedSender)) {
    return {
      isNonCustomer: true,
      category: 'otp_verification',
      reason: 'One-time verification code or security OTP notification.',
    };
  }

  // 7. Check Sign-in & Security Alerts
  const hasSigninSubject = /\b(new\s*device\s*signed\s*in|new\s*sign-?in|security\s*alert|review\s*activity)\b/i.test(cleanSubject);
  const hasSigninPattern = SIGNIN_SECURITY_PATTERNS.some((p) => p.test(combinedText));
  if (hasSigninSubject || (hasSigninPattern && (isAutomatedSender || cleanEmail.includes('shopify') || cleanEmail.includes('google')))) {
    return {
      isNonCustomer: true,
      category: 'security_signin_alert',
      reason: 'Sign-in activity or account security alert notification.',
    };
  }

  // 8. Check Password Resets
  const hasResetSubject = /\b(password\s*reset|reset\s*your\s*password)\b/i.test(cleanSubject);
  const hasResetPattern = PASSWORD_RESET_PATTERNS.some((p) => p.test(combinedText));
  if (hasResetSubject || (hasResetPattern && isAutomatedSender)) {
    return {
      isNonCustomer: true,
      category: 'password_reset',
      reason: 'Password reset or account authentication management email.',
    };
  }

  // 9. Check Marketing / Newsletter Broadcasts
  if (listUnsubscribe || (isAutomatedSender && NEWSLETTER_PROMO_PATTERNS.some((p) => p.test(bodyText)))) {
    return {
      isNonCustomer: true,
      category: 'newsletter_marketing',
      reason: 'Automated marketing broadcast or promotional newsletter.',
    };
  }

  // 10. If sender is automated/no-reply and has no genuine customer context
  if (isAutomatedSender) {
    return {
      isNonCustomer: true,
      category: 'system_notification',
      reason: `Automated service notification from system sender: ${cleanEmail}`,
    };
  }

  if (isAutomatedHeader) {
    return {
      isNonCustomer: true,
      category: 'system_notification',
      reason: 'Flagged as automated notification by mail provider.',
    };
  }

  // Genuine customer email
  return {
    isNonCustomer: false,
  };
}
