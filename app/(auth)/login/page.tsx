import { isPinSet } from "@/lib/services/auth";
import { PinForm } from "@/components/auth/pin-form";

export default async function LoginPage() {
  const pinExists = await isPinSet();

  return (
    <div className="flex min-h-screen items-center justify-center">
      <PinForm mode={pinExists ? "login" : "setup"} />
    </div>
  );
}
