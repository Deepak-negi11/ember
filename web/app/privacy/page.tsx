import Link from "next/link";
import { LegalPage } from "@/components/LegalPage.tsx";

export const metadata = { alternates: { canonical: "/privacy" }, title: "Privacy policy", description: "What Ember collects, what it never collects, and how it is used." };

const CONTACT = "https://github.com/Deepak-negi11/ember/issues";

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="20 October 2026">
      <section>
        <p>
          Ember is a coding-time tracker. It turns activity from your editor and AI coding agents into a heatmap, statistics and a leaderboard. This page explains exactly what Ember collects and what it does with it. In short: <strong>Ember records when and in which project you code, never what you write.</strong>
        </p>
      </section>

      <section>
        <h2>What Ember never collects</h2>
        <ul>
          <li>Your source code or the contents of any file.</li>
          <li>Full file paths. A one-way hash of the path is used only to avoid counting the same activity twice.</li>
          <li>Prompts you send to AI agents, or their replies. To count tokens, the Claude Code and Codex hooks read the agent&apos;s session log on your computer; only the numbers listed below leave it.</li>
          <li>Keystrokes, screenshots or clipboard contents.</li>
          <li>Your GitHub, Google or X password. Sign-in happens on their sites.</li>
        </ul>
      </section>

      <section>
        <h2>What Ember collects</h2>
        <ul>
          <li>
            <strong>From the sign-in provider</strong> (GitHub, Google or X): your name, username, profile photo and account ID. From Google, your email address if Google has verified it. From GitHub, your public bio, location and the X handle listed on your GitHub profile, used to pre-fill your Ember profile.
          </li>
          <li>
            <strong>What you add to your profile:</strong> display name, bio, quote, X and GitHub handles, website, location and time zone.
          </li>
          <li>
            <strong>Activity heartbeats</strong> sent by the Ember extension and the Claude Code / Codex hooks: a timestamp, the project name (the name of the folder or repository), the programming language, the git branch, which editor or agent was used, whether a file was saved, and the project&apos;s tech stack as detected from files such as <code>package.json</code>.
          </li>
          <li>
            <strong>AI token usage</strong> sent by the Claude Code and Codex hooks at the end of each agent turn: the model name (for example <code>claude-opus-5-5</code>), four token counts (input, output, cache reads, cache writes), the agent, a timestamp and a random-looking ID used to ignore repeated sends. Ember turns these into an estimated cost at public API prices. Turn it off with <code>&quot;send_usage&quot;: false</code> in <code>~/.ember/config.json</code>.
          </li>
          <li>
            <strong>Sign-in and security data:</strong> a session cookie that keeps you signed in, and your API key. Both are stored only as one-way hashes. Your theme choice (light or dark) is saved in your own browser.
          </li>
        </ul>
      </section>

      <section>
        <h2>How it is used</h2>
        <p>
          Only to provide Ember: to calculate your coding time, draw your heatmap and statistics, show your public profile and rank you on the leaderboard. Ember has no ads and does not sell or rent your data.
        </p>
      </section>

      <section>
        <h2>What is public</h2>
        <p>
          Your profile page at <code>/u/your-username</code> and the leaderboard are visible to anyone. They show your name, photo, username, bio, quote, the handles and website you added, your heatmap, total time, languages, tech stack, and your AI token counts, models and estimated spend. Project names are shown too, unless you turn on <strong>Hide project names</strong> in Settings. Your email address and API key are never shown.
        </p>
      </section>

      <section>
        <h2>Who processes the data</h2>
        <ul>
          <li><strong>Vercel</strong> hosts the website and API.</li>
          <li><strong>Turso</strong> stores the database.</li>
          <li><strong>GitHub, Google and X</strong> handle sign-in. Ember reads only the profile details listed above and never posts or changes anything on your accounts.</li>
        </ul>
      </section>

      <section>
        <h2>Keeping and deleting your data</h2>
        <p>
          Your data is kept while your account exists. You can remove the extension and hooks at any time with <code>embertime uninstall</code>, which stops all new data. To have your account and all of its data deleted, ask through the contact link below and it will be removed. Activity still waiting on your own computer is stored in <code>~/.ember</code>, and <code>embertime uninstall --purge</code> deletes it.
        </p>
      </section>

      <section>
        <h2>Children</h2>
        <p>Ember is not meant for children under 13, and accounts known to belong to them will be removed.</p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>
          If this policy changes, the date at the top will change with it. Questions or deletion requests: <a href={CONTACT} target="_blank" rel="noopener noreferrer">open an issue on GitHub</a>. See also the <Link href="/terms">terms of use</Link>.
        </p>
      </section>
    </LegalPage>
  );
}
