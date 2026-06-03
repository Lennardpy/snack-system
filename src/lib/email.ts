import { Resend } from "resend";

// Instantiated lazily so a missing key only errors at call-time, not at build time
let _resend: Resend | null = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY!);
  return _resend;
}

const FROM = process.env.EMAIL_FROM ?? "SSS <noreply@51vo.nl>";
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
