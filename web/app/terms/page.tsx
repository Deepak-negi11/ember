import Link from "next/link";
import { LegalPage } from "@/components/LegalPage.tsx";

export const metadata = { title: "Terms of use", description: "The rules for using Ember." };

const CONTACT = "https://github.com/Deepak-negi11/ember/issues";

export default function Terms() {
  return (
    <LegalPage title="Terms of use" updated="16 October 2026">
      <section>
        <p>
          By creating an Ember account or installing the Ember extension, CLI or agent hooks, you agree to these terms. If you don&apos;t agree, please don&apos;t use Ember.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <ul>
          <li>You sign in with GitHub, Google or X, and you are responsible for activity on your account.</li>
          <li>Keep your API key private. If it leaks, regenerate it in Settings; the old key stops working immediately.</li>
          <li>What you put on your profile (name, bio, quote, links) must be yours to share and must not be offensive, misleading or impersonate someone else.</li>
        </ul>
      </section>

      <section>
        <h2>Fair use and the leaderboard</h2>
        <ul>
          <li>Only send activity that comes from your own real work, through the official extension, CLI or hooks.</li>
          <li>Don&apos;t fake or script heartbeats to climb the leaderboard, and don&apos;t overload or attack the service.</li>
          <li>Accounts that break these rules can be removed from the leaderboard or deleted.</li>
        </ul>
      </section>

      <section>
        <h2>The service</h2>
        <p>
          Ember is provided free of charge and &ldquo;as is&rdquo;, without any guarantee that it will always be available, error-free or that statistics are perfectly accurate. Time is estimated from activity (see how time is counted on the home page). Features may change, and the service may be paused or shut down.
        </p>
      </section>

      <section>
        <h2>Liability</h2>
        <p>
          To the extent the law allows, Ember and its maintainers are not liable for any loss arising from using, or not being able to use, the service.
        </p>
      </section>

      <section>
        <h2>Privacy and contact</h2>
        <p>
          How your data is handled is described in the <Link href="/privacy">privacy policy</Link>. Questions: <a href={CONTACT} target="_blank" rel="noopener noreferrer">open an issue on GitHub</a>.
        </p>
      </section>
    </LegalPage>
  );
}
