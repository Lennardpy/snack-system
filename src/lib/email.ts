import { Resend } from "resend";

// Instantiated lazily so a missing key only errors at call-time, not at build time
let _resend: Resend | null = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY!);
  return _resend;
}

// Use a real, monitored from-address (not "no-reply") — mailbox providers trust
// it more, and members can reply. Set EMAIL_REPLY_TO to route replies elsewhere
// (e.g. the board inbox) while keeping a branded from-address.
const FROM = process.env.EMAIL_FROM ?? "Stress Snack System <snacks@51vo.nl>";
const REPLY_TO = process.env.EMAIL_REPLY_TO;
// BASE_URL is server-only (no NEXT_PUBLIC_ prefix) so it is never baked into
// the client bundle and always reflects the runtime environment variable.
const BASE_URL =
  process.env.BASE_URL ??
  process.env.NEXT_PUBLIC_BASE_URL ??
  "http://localhost:3000";

export async function sendCardVerificationEmail(
  to: string,
  firstName: string,
  token: string
) {
  const link = `${BASE_URL}/api/card/verify?token=${token}`;

  const { data, error } = await getResend().emails.send({
    from: FROM,
    to,
    ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
    subject: "Link your card to your SSS account",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Hi ${firstName},</h2>
        <p>Someone just tapped an unregistered card at the SSS kiosk.</p>
        <p>If that was you, click the button below to link the card to your account. The link expires in <strong>15 minutes</strong>.</p>
        <p style="margin: 32px 0;">
          <a href="${link}"
             style="background: #16a34a; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
            Link my card
          </a>
        </p>
        <p style="color: #9ca3af; font-size: 14px;">
          If you didn't tap a card, ignore this email. The link will expire automatically.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #9ca3af; font-size: 12px;">SSS &mdash; Stress Snack System</p>
      </div>
    `,
  });

  if (error) {
    console.error("Resend error:", JSON.stringify(error));
    throw new Error(`Email failed: ${error.message}`);
  }

  console.log("Resend sent:", data?.id);
}

// Invite email sent when an admin creates a bartender account. The link lets the
// bartender set their own password and does NOT expire.
export async function sendBartenderInviteEmail(to: string, token: string) {
  const link = `${BASE_URL}/set-password?token=${token}`;

  const { data, error } = await getResend().emails.send({
    from: FROM,
    to,
    ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
    subject: "Set up your SSS bartender account",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Welcome to the bar 🍺</h2>
        <p>An admin created a bartender account for you on the SSS / PPP system.</p>
        <p>Click the button below to choose your password. This link does not expire,
           so you can use it whenever you're ready.</p>
        <p style="margin: 32px 0;">
          <a href="${link}"
             style="background: #d97706; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
            Set my password
          </a>
        </p>
        <p style="color: #9ca3af; font-size: 14px;">
          After setting a password you can sign in at the PPP bar POS.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #9ca3af; font-size: 12px;">SSS &mdash; Stress Snack System</p>
      </div>
    `,
  });

  if (error) {
    console.error("Resend error:", JSON.stringify(error));
    throw new Error(`Email failed: ${error.message}`);
  }

  console.log("Resend sent (invite):", data?.id);
}
