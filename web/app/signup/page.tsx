import { redirect } from "next/navigation";

// Accounts are created on first sign-in with X or Google.
export default function Signup() {
  redirect("/login");
}
