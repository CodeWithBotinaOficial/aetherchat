<script>
  import { onMount, tick } from 'svelte';

  const LAST_UPDATED = 'March 17, 2026';

  /** @type {HTMLDivElement|null} */
  let scroller = null;
  let progress = 0;

  async function computeProgress() {
    if (!scroller) {
      progress = 0;
      return;
    }
    await tick();
    const max = scroller.scrollHeight - scroller.clientHeight;
    if (max <= 0) {
      progress = 0;
      return;
    }
    progress = Math.max(0, Math.min(1, scroller.scrollTop / max));
  }

  onMount(() => {
    void computeProgress();
    const onResize = () => computeProgress();
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      window.removeEventListener('resize', onResize);
    };
  });
</script>

<div class="terms h-full">
  <div bind:this={scroller} class="terms-scroll scroll-container" on:scroll={() => void computeProgress()}>
    <div class="progress-track" aria-hidden="true">
      <div class="progress-bar" style={`transform: scaleX(${progress});`}></div>
    </div>

    <header class="terms-header">
      <div class="header-inner">
        <div class="title">Terms of Service and Privacy Policy</div>
        <div class="updated">Last updated: {LAST_UPDATED}</div>
      </div>
    </header>

    <article class="doc" aria-label="Terms of Service and Privacy Policy">
      <h1 class="h1">TERMS OF SERVICE AND PRIVACY POLICY</h1>
      <p class="meta">
        <strong>AetherChat</strong> —
        <a class="link" href="https://aetherchat.codewithbotina.com" target="_blank" rel="noreferrer">https://aetherchat.codewithbotina.com</a><br />
        <strong>Last updated:</strong> {LAST_UPDATED}<br />
        <strong>Operated by:</strong> CodeWithBotinaOficial<br />
        <strong>Contact:</strong>
        <a class="link" href="https://github.com/CodeWithBotinaOficial/aetherchat" target="_blank" rel="noreferrer">
          https://github.com/CodeWithBotinaOficial/aetherchat
        </a>
      </p>

      <hr class="rule" />

      <h2 class="h2">1. ACCEPTANCE OF TERMS</h2>
      <p>
        By accessing or using AetherChat ("the Platform", "the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree
        to these Terms, you must immediately discontinue use of the Platform. These Terms constitute a legally binding agreement between you ("User",
        "you") and CodeWithBotinaOficial ("we", "us", "our", "Operator").
      </p>
      <p>
        We reserve the right to modify these Terms at any time. Continued use of the Platform after changes constitutes acceptance of the revised Terms.
      </p>

      <hr class="rule" />

      <h2 class="h2">2. DESCRIPTION OF SERVICE</h2>
      <p>
        AetherChat is a decentralized, peer-to-peer (P2P) communication platform that operates entirely within your web browser. The Service enables:
      </p>
      <ul class="list">
        <li>(a) Real-time text communication in a public global chat channel;</li>
        <li>(b) Private one-to-one messaging with end-to-end encryption;</li>
        <li>(c) User identity management via locally stored browser profiles.</li>
      </ul>
      <p class="callout">
        <strong>THE PLATFORM OPERATES WITHOUT CENTRALIZED SERVERS.</strong> All messages are transmitted directly between user browsers via WebRTC
        technology. We do not operate, control, or have access to any servers that route, store, or process user messages.
      </p>

      <hr class="rule" />

      <h2 class="h2">3. ELIGIBILITY</h2>
      <p><strong>3.1</strong> You must be at least 16 years of age to use this Service.</p>
      <p>
        <strong>3.2</strong> By registering, you confirm that you meet the minimum age requirement. The Platform implements a technical age gate; however,
        we cannot independently verify user ages. Parents and guardians are responsible for monitoring the online activities of minors under their
        supervision.
      </p>
      <p>
        <strong>3.3</strong> If you are between 16 and 18 years of age, you represent that your parent or legal guardian has reviewed and agreed to these
        Terms on your behalf.
      </p>

      <hr class="rule" />

      <h2 class="h2">4. USER ACCOUNTS AND IDENTITY</h2>
      <p>
        <strong>4.1 USERNAME:</strong> You must choose a username to use the Service. Your username is your sole identifier on the Platform. You are
        responsible for maintaining the uniqueness and appropriateness of your chosen username.
      </p>
      <p>
        <strong>4.2 ANONYMITY:</strong> We strongly recommend that you do NOT use your real name, surname, email address, phone number, or any other
        personally identifiable information as your username or in any content you share on the Platform.
      </p>
      <p>
        <strong>4.3 PERSISTENCE:</strong> Your profile is stored locally in your browser (IndexedDB/localStorage). We do not store your profile on any
        server. Clearing your browser data will permanently delete your profile and chat history.
      </p>
      <p>
        <strong>4.4 USERNAME UNIQUENESS:</strong> The Platform uses a decentralized mechanism to prevent duplicate usernames. In rare race conditions,
        duplicates may occur. We are not liable for any confusion arising from username collisions.
      </p>

      <hr class="rule" />

      <h2 class="h2">5. USER CONDUCT AND PROHIBITED CONTENT</h2>
      <p><strong>5.1</strong> You agree NOT to use the Platform to transmit, share, post, or otherwise communicate:</p>
      <ul class="list">
        <li>(a) Content that is unlawful, harmful, threatening, abusive, harassing, defamatory, vulgar, obscene, or otherwise objectionable;</li>
        <li>
          (b) Content that violates any applicable local, national, or international law or regulation, including but not limited to laws regarding
          privacy, data protection, intellectual property, and consumer protection;
        </li>
        <li>(c) Content that constitutes, facilitates, or promotes child sexual abuse material (CSAM) or the exploitation of minors in any form;</li>
        <li>
          (d) Content that constitutes hate speech, discrimination, or incitement to violence based on race, ethnicity, nationality, religion, gender,
          sexual orientation, disability, or any other characteristic;
        </li>
        <li>(e) Spam, phishing attempts, malware, or any content designed to deceive or harm other users;</li>
        <li>(f) Personal information of third parties without their explicit consent;</li>
        <li>(g) Content that infringes upon any intellectual property rights.</li>
      </ul>
      <p>
        <strong>5.2</strong> We do not actively monitor, review, or moderate content transmitted through the Platform. Due to the decentralized,
        peer-to-peer nature of the Service, we have no technical capability to intercept, read, or moderate private messages.
      </p>
      <p><strong>5.3</strong> You acknowledge that you are solely and exclusively responsible for all content you transmit using the Platform.</p>

      <hr class="rule" />

      <h2 class="h2">6. DISCLAIMER OF LIABILITY FOR USER CONTENT</h2>
      <p class="callout">
        <strong>6.1 OPERATOR NOT RESPONSIBLE FOR USER CONTENT:</strong> THE OPERATOR EXPRESSLY DISCLAIMS ALL RESPONSIBILITY AND LIABILITY FOR ANY CONTENT
        TRANSMITTED, SHARED, OR COMMUNICATED BY USERS THROUGH THE PLATFORM, WHETHER IN PUBLIC GLOBAL CHAT OR PRIVATE MESSAGES.
      </p>
      <p>
        <strong>6.2</strong> We are a technology provider only. We provide the technical framework for peer-to-peer communication but exercise no editorial
        control over user-generated content.
      </p>
      <p>
        <strong>6.3</strong> By using the Platform, you agree to indemnify, defend, and hold harmless CodeWithBotinaOficial, its operators, contributors,
        and affiliates from and against any claims, liabilities, damages, losses, costs, or expenses (including legal fees) arising out of or in any way
        connected with:
      </p>
      <ul class="list">
        <li>(a) Your use of the Platform;</li>
        <li>(b) Any content you transmit through the Platform;</li>
        <li>(c) Your violation of these Terms;</li>
        <li>(d) Your violation of any rights of another person or entity.</li>
      </ul>
      <p>
        <strong>6.4</strong> If you believe content transmitted through the Platform violates applicable law, you should report it to the appropriate law
        enforcement authorities. We cooperate with law enforcement to the extent required by applicable law, which is limited given the decentralized
        nature of the Service.
      </p>

      <hr class="rule" />

      <h2 class="h2">7. PRIVACY AND DATA HANDLING</h2>
      <p><strong>7.1 DATA WE DO NOT COLLECT:</strong> We do not collect, store, process, or transmit:</p>
      <ul class="list">
        <li>Your messages (public or private)</li>
        <li>Your username or profile data</li>
        <li>Your IP address (beyond what is inherent to WebRTC — see 7.2)</li>
        <li>Your device information</li>
        <li>Any analytics or telemetry data</li>
      </ul>
      <p>
        <strong>7.2 WEBRTC AND IP ADDRESSES:</strong> Due to the technical nature of WebRTC (the technology enabling peer-to-peer connections), your IP
        address may be visible to other users you connect with directly. This is an inherent characteristic of P2P technology and cannot be avoided
        without a VPN or proxy service. By using the Platform, you acknowledge and accept this technical reality.
      </p>
      <p>
        <strong>7.3 LOCAL STORAGE:</strong> All Platform data (your profile, chat history, user registry) is stored exclusively in your browser's local
        storage (IndexedDB). This data never leaves your device unless transmitted directly to peers you connect with.
      </p>
      <p><strong>7.4 NO COOKIES:</strong> The Platform does not use tracking cookies, advertising cookies, or any third-party analytics services.</p>
      <p>
        <strong>7.5 NO THIRD-PARTY DATA SHARING:</strong> We do not sell, rent, or share any user data with third parties for commercial purposes.
      </p>
      <p><strong>7.6 DATA RETENTION:</strong> All locally stored data is automatically deleted according to the following schedule:</p>
      <ul class="list">
        <li>Global chat messages: 24 hours from receipt</li>
        <li>Private messages: 30 days from last activity</li>
        <li>User profiles: 1 year from creation</li>
        <li>Username registry: 1 year</li>
      </ul>
      <p>
        <strong>7.7 YOUR RIGHTS:</strong> You may delete all locally stored data at any time by clearing your browser's site data for this domain. This
        action is irreversible.
      </p>

      <hr class="rule" />

      <h2 class="h2">8. END-TO-END ENCRYPTION</h2>
      <p>
        <strong>8.1</strong> Private messages on the Platform are end-to-end encrypted using industry-standard cryptographic algorithms (ECDH P-256 key
        exchange, AES-GCM 256-bit encryption).
      </p>
      <p>
        <strong>8.2</strong> Encryption keys are generated locally in your browser and are never transmitted to any server. Only the intended recipient can
        decrypt private messages.
      </p>
      <p>
        <strong>8.3</strong> We make no warranty regarding the absolute security of any communication system. Users with sophisticated technical
        capabilities may be able to compromise encryption at the endpoint level (i.e., on your device). We are not responsible for security breaches
        resulting from compromise of a user's device or browser.
      </p>
      <p><strong>8.4</strong> Public global chat messages are NOT encrypted end-to-end. They are transmitted in plaintext to all connected peers.</p>

      <hr class="rule" />

      <h2 class="h2">9. INTELLECTUAL PROPERTY</h2>
      <p>
        <strong>9.1</strong> The AetherChat software is open source and licensed under the MIT License. The source code is available at:
        <a class="link" href="https://github.com/CodeWithBotinaOficial/aetherchat" target="_blank" rel="noreferrer">
          https://github.com/CodeWithBotinaOficial/aetherchat
        </a>
      </p>
      <p>
        <strong>9.2</strong> Content you create and transmit remains your own. By transmitting content through the Platform, you represent that you have the
        right to do so.
      </p>
      <p><strong>9.3</strong> The "AetherChat" name and "CodeWithBotinaOficial" brand are owned by the Operator.</p>

      <hr class="rule" />

      <h2 class="h2">10. DISCLAIMERS AND LIMITATION OF LIABILITY</h2>
      <p>
        <strong>10.1</strong> THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT
        NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
      </p>
      <p>
        <strong>10.2</strong> WE DO NOT WARRANT THAT:
      </p>
      <ul class="list">
        <li>(a) The Platform will be uninterrupted, error-free, or secure;</li>
        <li>(b) Any defects will be corrected;</li>
        <li>(c) The Platform is free of viruses or harmful components;</li>
        <li>(d) The results of using the Platform will meet your requirements.</li>
      </ul>
      <p>
        <strong>10.3</strong> TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL CODEWITHBOTINAOFICIAL BE LIABLE FOR ANY INDIRECT,
        INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES,
        RESULTING FROM YOUR USE OF THE PLATFORM.
      </p>
      <p>
        <strong>10.4</strong> OUR TOTAL LIABILITY TO YOU FOR ANY CLAIM ARISING FROM THESE TERMS OR YOUR USE OF THE PLATFORM SHALL NOT EXCEED ZERO DOLLARS
        (USD $0.00), REFLECTING THE FACT THAT THE SERVICE IS PROVIDED FREE OF CHARGE.
      </p>

      <hr class="rule" />

      <h2 class="h2">11. GOVERNING LAW AND DISPUTE RESOLUTION</h2>
      <p><strong>11.1</strong> These Terms shall be governed by and construed in accordance with applicable law.</p>
      <p>
        <strong>11.2</strong> Any dispute arising from these Terms or your use of the Platform shall first be attempted to be resolved informally by
        contacting us via the GitHub repository.
      </p>
      <p>
        <strong>11.3</strong> If informal resolution fails, disputes shall be resolved through binding arbitration rather than in court, except where
        prohibited by applicable law.
      </p>

      <hr class="rule" />

      <h2 class="h2">12. TERMINATION</h2>
      <p><strong>12.1</strong> You may stop using the Platform at any time by closing your browser and clearing your browser data.</p>
      <p><strong>12.2</strong> We reserve the right to modify, suspend, or discontinue the Platform at any time without notice.</p>

      <hr class="rule" />

      <h2 class="h2">13. SEVERABILITY</h2>
      <p>
        If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent
        necessary so that these Terms shall otherwise remain in full force and effect.
      </p>

      <hr class="rule" />

      <h2 class="h2">14. ENTIRE AGREEMENT</h2>
      <p>
        These Terms constitute the entire agreement between you and CodeWithBotinaOficial regarding the use of the Platform and supersede all prior
        agreements.
      </p>

      <hr class="rule" />

      <h2 class="h2">CONTACT</h2>
      <p>
        GitHub:
        <a class="link" href="https://github.com/CodeWithBotinaOficial/aetherchat" target="_blank" rel="noreferrer">
          https://github.com/CodeWithBotinaOficial/aetherchat
        </a>
      </p>
    </article>
  </div>
</div>

<style>
  .terms {
    background: var(--bg-base);
    color: var(--text-primary);
    height: 100%;
  }

  .terms-scroll {
    height: 100%;
  }

  .progress-track {
    position: sticky;
    top: 0;
    height: 3px;
    background: color-mix(in srgb, var(--border) 70%, transparent);
    z-index: 5;
  }

  .progress-bar {
    height: 100%;
    width: 100%;
    transform-origin: left center;
    background: var(--accent);
  }

  .terms-header {
    position: sticky;
    top: 3px;
    z-index: 4;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
    backdrop-filter: blur(10px);
  }

  .header-inner {
    max-width: 720px;
    margin: 0 auto;
    padding: 12px 16px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .title {
    font-weight: 800;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .updated {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .doc {
    max-width: 720px;
    margin: 0 auto;
    padding: 16px 16px 48px;
    color: var(--text-secondary);
    line-height: 1.65;
  }

  .h1,
  .h2 {
    color: var(--text-primary);
    margin: 0;
  }

  .h1 {
    font-size: 1.35rem;
    font-weight: 900;
    letter-spacing: -0.02em;
  }

  .h2 {
    margin-top: 22px;
    font-size: 1.05rem;
    font-weight: 800;
    letter-spacing: -0.01em;
  }

  p {
    margin: 10px 0 0;
  }

  .meta {
    margin-top: 10px;
  }

  .rule {
    border: 0;
    height: 1px;
    background: var(--border);
    margin: 18px 0;
    opacity: 0.9;
  }

  .list {
    margin: 10px 0 0;
    padding-left: 18px;
  }

  .callout {
    margin-top: 10px;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--accent-subtle) 60%, var(--bg-surface));
    color: var(--text-primary);
  }

  .link {
    color: var(--accent);
    text-decoration: none;
  }

  @media (hover: hover) {
    .link:hover {
      color: var(--accent-hover);
      text-decoration: underline;
    }
  }
</style>
