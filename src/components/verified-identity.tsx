import { LineIdentity } from "@/components/auth-shell";
import { ProfileAvatar } from "@/components/profile-avatar";
import { avatarSrc, initialOf } from "@/lib/avatar";

/** The LINE account and the verified number at the top of the claim and access-request pages. */
export function VerifiedIdentity({ lineName, picture, phone }: { lineName: string; picture: string | null; phone: string }) {
  const name = lineName || "ผู้ใช้ LINE";
  return <LineIdentity name={name} phone={phone} avatar={<ProfileAvatar src={avatarSrc(picture)} initial={initialOf(name)} size={28} />} />;
}
