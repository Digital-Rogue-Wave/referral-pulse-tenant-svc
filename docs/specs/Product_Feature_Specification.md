# 🛠️ Product Feature Specification v3.0
## Referral Marketing SaaS Platform - Complete Feature List

**Version:** 3.0  
**Updated:** December 2024  
**Changes:** AI Reward Intelligence (MVP), AI-Powered Analytics, Payment Enforcement, GDPR Compliance, Account Lifecycle

---

# 📋 Document Updates from v2.0

| Change | Description |
|--------|-------------|
| **AI Reward & Payout Intelligence** | Moved to MVP - auto-approval, risk scoring, fraud detection |
| **AI-Powered Analytics** | Added natural language queries, dynamic visualizations |
| **Payment Enforcement** | Account states: active → past_due → restricted → locked |
| **GDPR Compliance** | Expanded with data export, deletion, retention automation |
| **Account Lifecycle** | Member removal, account deletion, audit logging |
| **SDK Behavior by State** | How SDK/Tracker responds to locked/deleted accounts |
| **Wildcard Subdomain** | Using `*.referralapp.io` for MVP (no custom domains) |

---

# 📋 Feature Overview

## Legend

| Symbol | Meaning |
|--------|---------|
| **(MVP)** | Must have for launch - core functionality |
| **(V1.1)** | Add within 3 months post-launch |
| **(V1.2)** | Add within 6 months post-launch |
| **(V2)** | Future roadmap (6-12 months) |
| ⭐ | Recommended to add from start (low effort, high impact) |
| 🤖 | AI-powered feature (your differentiator) |
| 🔧 | API-first feature (developer focus) |
| 🆕 | New or updated in v3.0 |

---

# 1️⃣ REFERRAL TRACKING ENGINE

## Core Tracking

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Referral link generation** | **(MVP)** | Unique trackable links per user | Medium |
| **Referral link click tracking** | **(MVP)** | Track clicks with timestamps, source | Medium |
| **Cookie-based attribution** | **(MVP)** | 30/60/90 day configurable cookies | Medium |
| **Referral code with optional discount** | **(MVP)** ⭐ | Single system: track + optional discount | Medium |
| **Email-based tracking** | **(MVP)** | Match referrals by email | Low |
| **First-touch attribution** | **(MVP)** | Credit first referrer (default) | Low |
| **Last-touch attribution** | **(V1.1)** | Credit last referrer (optional) | Low |
| **Configurable attribution** | **(V1.1)** | Let customer choose first/last | Low |
| **Multi-touch attribution** | **(V2)** | Split credit across touchpoints | High |
| **Cross-device tracking** | **(V1.2)** | Track across devices via login | High |
| **UTM parameter passthrough** | **(MVP)** ⭐ | Pass UTM params to destination | Low |
| **Custom tracking parameters** | **(V1.1)** | Add custom params to links | Low |
| **QR code generation** | **(MVP)** ⭐ | Generate QR codes for links | Low |
| **Link shortening** | **(MVP)** ⭐ | Short branded links | Low |
| **Deep linking** | **(V1.2)** | Link to specific pages/features | Medium |
| **Offline conversion tracking** | **(V2)** | Import offline conversions via API | Medium |

## Conversion Tracking

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Signup tracking** | **(MVP)** | Track when referral signs up | Medium |
| **Trial start tracking** | **(MVP)** | Track trial conversions | Low |
| **Paid conversion tracking** | **(MVP)** | Track when referral pays | Medium |
| **Subscription tracking** | **(MVP)** | Track recurring payments | High |
| **Upgrade tracking** | **(MVP)** ⭐ | Track plan upgrades | Medium |
| **Downgrade tracking** | **(MVP)** ⭐ | Track plan downgrades | Medium |
| **Churn tracking** | **(MVP)** | Track cancellations | Medium |
| **Refund handling** | **(MVP)** | Adjust commissions on refunds | Medium |
| **MRR/ARR calculation** | **(MVP)** | Calculate recurring revenue | Medium |
| **Revenue per referral** | **(MVP)** | Track lifetime value per referral | Medium |
| **Custom conversion events** | **(V1.1)** 🔧 | Define custom events via API | Medium |
| **Conversion value tracking** | **(MVP)** | Track deal/order values | Low |
| **Multi-product tracking** | **(V1.2)** | Track across product lines | High |

---

# 2️⃣ CAMPAIGN MANAGEMENT

## Campaign Creation - Dual Mode

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🤖 **AI Chatbot Builder (default)** | **(MVP)** | Conversational campaign setup | High |
| **Manual Stepper Builder** | **(MVP)** | Step-by-step wizard for power users | Medium |
| **Mode switching** | **(MVP)** | Switch between AI and manual mid-flow | Low |
| **Campaign templates library** | **(MVP)** ⭐ | Pre-built campaign types | Medium |
| **Multiple campaigns** | **(MVP)** | Run multiple programs | Medium |
| **Campaign duplication** | **(MVP)** ⭐ | Clone existing campaigns | Low |
| **Campaign scheduling** | **(V1.1)** | Schedule start/end dates | Low |
| **Campaign status management** | **(MVP)** | Draft, active, paused, ended | Low |
| **Campaign goals/targets** | **(V1.1)** | Set campaign objectives | Low |
| **A/B campaign testing** | **(V1.2)** | Test campaign variations | High |
| **Campaign versioning** | **(V2)** | Track campaign changes | Medium |

## AI Campaign Setup Flow

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🤖 **URL analysis engine** | **(MVP)** | Extract product info from website | High |
| 🤖 **Product type detection** | **(MVP)** | Identify SaaS, API, tool, etc. | Medium |
| 🤖 **Pricing model detection** | **(MVP)** | Detect freemium, paid, usage-based | Medium |
| 🤖 **Brand extraction** | **(MVP)** | Extract colors, logo, tone | Medium |
| 🤖 **3 template generation** | **(MVP)** | Generate 3 complete campaign options | High |
| 🤖 **Smart questions** | **(MVP)** | Ask for missing info intelligently | Medium |
| 🤖 **Template customization chat** | **(MVP)** | Refine selected template via chat | Medium |

## Campaign Types (Pulses) 🆕

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Referral pulse** | **(MVP)** | Classic user-refers-user program | Core |
| **Two-sided rewards** | **(MVP)** | Reward both parties | Medium |
| **One-sided rewards** | **(MVP)** | Reward referrer only | Low |
| **Signup pulse** | **(MVP)** 🆕 | Incentivize signups (free users) | Medium |
| **Conversion pulse** | **(MVP)** 🆕 | Incentivize first purchase | Medium |
| **Reactivation pulse** | **(V1.1)** 🆕 ⭐ | Re-engage dormant users | Medium |
| **Renewal pulse** | **(V1.1)** 🆕 ⭐ | Encourage subscription renewals | Medium |
| **Feedback pulse** | **(V1.1)** 🆕 | Get G2/Capterra/Trustpilot reviews | High |
| **Cross-sell pulse** | **(V1.2)** 🆕 | Upsell existing customers | Medium |
| **Switchup pulse** | **(V1.2)** 🆕 | Acquire competitor customers | Medium |
| **Newsletter pulse** | **(V1.1)** 🆕 | Grow email list | Low |
| **Education pulse** | **(V1.2)** 🆕 | Drive feature adoption | Medium |
| **Affiliate program** | **(V1.2)** | External affiliate/partner | High |
| **Partner program** | **(V2)** | Reseller/agency partners | High |
| **Employee referral** | **(V1.2)** | Internal employee referrals | Medium |
| **Influencer program** | **(V2)** | Influencer-specific features | Medium |
| **Ambassador program** | **(V2)** | Long-term advocates | Medium |
| **Waitlist/viral campaign** | **(V1.1)** ⭐ | Pre-launch viral loops | Medium |
| **Contest/sweepstakes** | **(V1.2)** | Time-limited competitions | Medium |

## Reward Configuration

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Cash rewards** | **(MVP)** | Money payouts | Medium |
| **Percentage commission** | **(MVP)** | % of sale/subscription | Medium |
| **Fixed amount rewards** | **(MVP)** | Flat fee per referral | Low |
| **Recurring commissions** | **(MVP)** ⭐ | Ongoing % of subscription | High |
| **One-time commissions** | **(MVP)** | Single payment per referral | Low |
| **Tiered rewards** | **(V1.1)** ⭐ | Different rewards by volume | Medium |
| **Milestone rewards** | **(V1.1)** | Bonuses at thresholds | Medium |
| **Credit/account balance** | **(V1.1)** | In-app credit rewards | Medium |
| **Referral code discounts** | **(MVP)** ⭐ | Optional discount attached to code | Medium |
| **Gift cards** | **(V1.2)** | Third-party gift cards | High |
| **Custom rewards** | **(V1.2)** | Define custom reward types | Medium |
| **Donation rewards** | **(V2)** | Donate to charity | Medium |
| **Product/feature unlock** | **(V1.2)** | Unlock premium features | Medium |
| **Multi-currency rewards** | **(MVP)** ⭐ | EUR, USD, GBP, CHF | Medium |
| **Reward caps** | **(MVP)** ⭐ | Maximum per referral/total | Low |
| **Reward expiration** | **(V1.1)** | Time-limited rewards | Low |
| 🤖 **AI reward optimization** | **(V1.2)** | AI suggests optimal rewards | High |

---

# 3️⃣ AI FEATURES 🤖 (Your Differentiator)

## AI Campaign Builder

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🤖 **AI chatbot interface** | **(MVP)** | Conversational campaign creation | High |
| 🤖 **Website URL analysis** | **(MVP)** | AI scrapes and analyzes product | High |
| 🤖 **3 template generation** | **(MVP)** | AI creates 3 complete campaigns | High |
| 🤖 **Template comparison view** | **(MVP)** | Side-by-side template preview | Medium |
| 🤖 **Reward recommendation** | **(MVP)** ⭐ | AI suggests optimal rewards | Medium |
| 🤖 **Industry benchmarking** | **(MVP)** | Compare to similar companies | Medium |
| 🤖 **Best practices suggestions** | **(MVP)** ⭐ | AI provides tips during setup | Low |
| 🤖 **Target audience detection** | **(V1.1)** | AI identifies ideal referrers | Medium |
| 🤖 **Competitor analysis** | **(V1.2)** | AI compares to competitors | Medium |

## AI Content Generation

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🤖 **Complete template generation** | **(MVP)** | Full campaign with all assets | High |
| 🤖 **Email template generation (3 per campaign)** | **(MVP)** ⭐ | AI writes referral emails | Medium |
| 🤖 **Landing page copy** | **(MVP)** ⭐ | AI generates landing page text | Medium |
| 🤖 **Social sharing messages** | **(MVP)** ⭐ | AI writes share messages | Low |
| 🤖 **Widget copy generation** | **(MVP)** ⭐ | AI writes widget text | Low |
| 🤖 **CTA optimization** | **(V1.1)** | AI suggests best CTAs | Low |
| 🤖 **Tone/voice matching** | **(MVP)** | AI matches brand voice from URL | Medium |
| 🤖 **Multi-language generation** | **(V1.2)** | AI generates in DE/EN/FR | Medium |
| 🤖 **A/B copy suggestions** | **(V1.2)** | AI creates test variations | Medium |
| 🤖 **Subject line generation** | **(MVP)** ⭐ | AI writes email subjects | Low |

## AI Reward & Payout Intelligence 🆕 (MVP)

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🤖 **Risk scoring** | **(MVP)** 🆕 | Score each reward 0-100 for risk | High |
| 🤖 **Auto-approval (low-risk)** | **(MVP)** 🆕 | Automatically approve low-risk rewards | Medium |
| 🤖 **Auto-escalation (high-risk)** | **(MVP)** 🆕 | Flag high-risk for manual review | Medium |
| 🤖 **Fraud pattern detection** | **(MVP)** 🆕 ⭐ | Same IP, velocity, self-referral patterns | High |
| 🤖 **Approval confidence** | **(MVP)** 🆕 | Show confidence percentage with reason | Low |
| 🤖 **Payout method suggestion** | **(V1.1)** | "Wise cheaper for EU" | Low |
| 🤖 **Tax threshold alerts** | **(V1.1)** | "Approaching €600 threshold" | Low |
| 🤖 **Commission optimization** | **(V1.2)** | Suggest optimal commission rates | Medium |

## AI Fraud Detection 🆕 (MVP)

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🤖 **Same IP pattern** | **(MVP)** 🆕 | Detect multiple referrals from same IP | Medium |
| 🤖 **Velocity checks** | **(MVP)** 🆕 | Unusual signup speed detection | Medium |
| 🤖 **Self-referral detection** | **(MVP)** 🆕 | Email pattern matching | Medium |
| 🤖 **Geographic anomalies** | **(MVP)** 🆕 | Referrer location vs referral locations | Medium |
| 🤖 **Bot behavior detection** | **(V1.1)** | Click pattern analysis | High |
| 🤖 **Device fingerprint matching** | **(V1.1)** | Same device, different users | High |
| 🤖 **Conversion pattern analysis** | **(V1.1)** | Suspicious conversion timing | Medium |

## AI Analytics & Insights

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🤖 **Performance insights** | **(V1.1)** ⭐ | AI explains metrics in plain language | Medium |
| 🤖 **Good news / watch out / opportunity** | **(V1.1)** | Categorized insights | Medium |
| 🤖 **Anomaly detection** | **(V1.1)** 🆕 | AI flags unusual patterns | High |
| 🤖 **Spike/drop alerts** | **(V1.1)** 🆕 | Automatic performance alerts | Medium |
| 🤖 **Optimization recommendations** | **(V1.1)** ⭐ | AI suggests specific improvements | Medium |
| 🤖 **Actionable next steps** | **(V1.1)** | One-click implement suggestions | Medium |
| 🤖 **Referrer scoring** | **(V1.2)** | AI scores referrer potential | Medium |
| 🤖 **Predictive analytics** | **(V2)** | AI predicts future performance | High |
| 🤖 **30-day forecast** | **(V2)** | Predict referrals, revenue | High |
| 🤖 **Churn prediction** | **(V2)** | AI predicts referrer churn | High |
| 🤖 **Automated report summaries** | **(V1.2)** | AI-generated report narratives | Medium |
| 🤖 **Weekly insight emails** | **(V1.1)** | AI writes weekly summaries | Medium |

## AI-Powered Analytics 🆕

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🤖 **Natural language queries** | **(V1.2)** 🆕 | Ask questions in plain English | High |
| 🤖 **AI visualization selection** | **(V1.2)** 🆕 | AI picks best chart type | Medium |
| 🤖 **Dynamic report generation** | **(V1.2)** 🆕 | AI creates custom reports on demand | High |
| 🤖 **Root cause analysis** | **(V1.2)** 🆕 | AI explains why metrics changed | High |
| 🤖 **Context-aware dashboards** | **(V2)** 🆕 | Dashboard adapts to tenant state | High |
| 🤖 **Conversational analytics** | **(V2)** 🆕 | Full chat interface for data | High |

## AI Referrer Engagement 🆕

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🤖 **Dormant re-engagement** | **(V1.1)** 🆕 | Detect and email inactive referrers | Medium |
| 🤖 **Milestone celebrations** | **(V1.1)** 🆕 | Celebrate achievements automatically | Low |
| 🤖 **Coaching tips** | **(V1.2)** 🆕 | Personalized referrer advice | Medium |
| 🤖 **Churn prevention** | **(V1.2)** 🆕 | Intervene before referrer churns | High |
| 🤖 **Optimal send times** | **(V1.2)** 🆕 | Best time to email each referrer | Medium |

## AI Automation

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🤖 **Smart send times** | **(V1.2)** | AI optimizes email timing | Medium |
| 🤖 **Automated A/B testing** | **(V2)** | AI runs and analyzes tests | High |
| 🤖 **Dynamic personalization** | **(V1.2)** | AI personalizes content | High |
| 🤖 **Auto-optimization** | **(V2)** | AI adjusts campaigns automatically | High |
| 🤖 **Autopilot mode** | **(V2)** 🆕 | Full AI campaign management | High |

---

# 4️⃣ EMBEDDABLE WIDGET & SDK 🔧

## Widget Types

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Referral widget (modal)** | **(MVP)** | Pop-up referral interface | High |
| **Referral widget (inline)** | **(MVP)** ⭐ | Embedded in page | Medium |
| **Referral widget (floating)** | **(V1.1)** ⭐ | Floating button/tab | Medium |
| **Full-page referral portal** | **(V1.1)** | Dedicated referral page | Medium |
| **Sidebar widget** | **(V1.1)** | Side panel interface | Medium |
| **Mini widget** | **(V1.1)** ⭐ | Compact version | Low |

## Widget Features

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Copy referral link** | **(MVP)** | One-click copy | Low |
| **Social sharing buttons** | **(MVP)** ⭐ | Share to social platforms | Medium |
| **Email sharing** | **(MVP)** | Share via email | Medium |
| **WhatsApp sharing** | **(MVP)** ⭐ | Share to WhatsApp (critical for DACH) | Low |
| **LinkedIn sharing** | **(MVP)** ⭐ | Share to LinkedIn (B2B essential) | Low |
| **Twitter/X sharing** | **(MVP)** | Share to Twitter | Low |
| **SMS sharing** | **(V1.1)** | Share via SMS | Low |
| **Referral status display** | **(MVP)** | Show pending/completed | Medium |
| **Reward balance display** | **(MVP)** | Show earnings | Low |
| **Referral history** | **(MVP)** | List past referrals | Medium |
| **Progress indicators** | **(V1.1)** ⭐ | Visual progress to goals | Low |
| **Leaderboard widget** | **(V1.2)** | Top referrers display | Medium |
| **QR code display** | **(MVP)** ⭐ | Show QR in widget | Low |

## Widget Customization

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Color customization** | **(MVP)** ⭐ | Match brand colors | Medium |
| **Logo upload** | **(MVP)** ⭐ | Custom logo in widget | Low |
| **Font customization** | **(V1.1)** | Match brand fonts | Medium |
| **Text customization** | **(MVP)** ⭐ | Edit all widget text | Medium |
| **Position customization** | **(MVP)** | Control widget placement | Low |
| **Size customization** | **(V1.1)** | Adjust dimensions | Low |
| **CSS override** | **(V1.1)** 🔧 | Custom CSS injection | Medium |
| **Dark mode support** | **(MVP)** ⭐ | Dark theme option | Low |
| **Remove branding** | **(V1.2)** | White-label (paid tier) | Low |
| **Custom HTML templates** | **(V1.2)** 🔧 | Full template control | High |
| 🤖 **AI style matching** | **(MVP)** | AI matches site style from URL | Medium |

## SDK & Technical

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🔧 **JavaScript SDK** | **(MVP)** | Vanilla JS integration | High |
| 🔧 **React SDK** | **(MVP)** ⭐ | React components | Medium |
| 🔧 **Vue SDK** | **(V1.1)** ⭐ | Vue components | Medium |
| 🔧 **Angular SDK** | **(V1.2)** | Angular components | Medium |
| 🔧 **iOS SDK** | **(V2)** | Native iOS | High |
| 🔧 **Android SDK** | **(V2)** | Native Android | High |
| 🔧 **React Native SDK** | **(V1.2)** | Cross-platform mobile | High |
| 🔧 **Flutter SDK** | **(V2)** | Flutter integration | High |
| **Script async loading** | **(MVP)** | Non-blocking load | Low |
| **Lazy loading** | **(MVP)** ⭐ | Load on demand | Low |
| **Event callbacks** | **(MVP)** 🔧 | JS event hooks | Medium |
| **Programmatic control** | **(MVP)** 🔧 | Open/close via code | Low |
| **First-party cookies** | **(MVP)** | SDK creates cookies on client domain | Medium |
| **localStorage fallback** | **(MVP)** | Fallback if cookies blocked | Low |
| **SSE real-time updates** | **(MVP)** | Push updates instead of polling | Medium |
| **CDN-cached config** | **(MVP)** | Fast config loading from edge | Medium |
| **Cross-subdomain support** | **(V1.1)** | Cookie sharing across subdomains | Medium |

## SDK Behavior by Account State 🆕

| Account State | Widget Display | Tracking | Landing Pages |
|---------------|----------------|----------|---------------|
| **Active** | Normal | ✅ Works | ✅ Works |
| **Past Due** | Normal | ✅ Works | ✅ Works |
| **Restricted** | Normal | ✅ Works | ✅ Works |
| **Locked** | Hidden/fallback | ❌ 402 | "Program paused" |
| **Deleted** | Hidden (404) | ❌ 404 | 404 |

---

# 5️⃣ LANDING PAGES

## Landing Page Builder

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Auto-generated landing pages** | **(MVP)** ⭐ | Create per referrer | Medium |
| **Landing page templates** | **(MVP)** ⭐ | Pre-built designs | Medium |
| 🤖 **AI landing page generation** | **(MVP)** ⭐ | AI creates full page from URL | High |
| **Visual page editor** | **(V1.2)** | Drag-drop builder | High |
| **Custom domain support** | **(V1.1)** ⭐ | Use your own domain | Medium |
| **SSL for custom domains** | **(V1.1)** | Automatic HTTPS | Medium |
| **Mobile-responsive** | **(MVP)** | Works on all devices | Included |
| **SEO settings** | **(V1.1)** | Meta tags, OG tags | Low |
| **Conversion tracking pixel** | **(MVP)** | Track page conversions | Low |

## Landing Page Features

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Referrer personalization** | **(MVP)** ⭐ | Show referrer name/photo | Low |
| **Dynamic content** | **(V1.1)** | Content based on source | Medium |
| **Countdown timers** | **(V1.2)** | Urgency elements | Low |
| **Social proof elements** | **(V1.1)** ⭐ | Testimonials, stats | Low |
| **Video embed** | **(V1.1)** | Product videos | Low |
| **Form integration** | **(V1.1)** | Lead capture forms | Medium |
| **Multi-language pages** | **(V1.2)** | DE/EN/FR versions | Medium |
| **A/B testing** | **(V2)** | Test page variations | High |

---

# 6️⃣ EMAIL & NOTIFICATIONS

## Transactional Emails

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Referral sent notification** | **(MVP)** | Email when referral made | Low |
| **Referral signup notification** | **(MVP)** | Email when referral signs up | Low |
| **Referral converted notification** | **(MVP)** | Email when referral pays | Low |
| **Reward earned notification** | **(MVP)** | Email when reward credited | Low |
| **Payout sent notification** | **(MVP)** | Email when money sent | Low |
| **Welcome email** | **(MVP)** ⭐ | Email when joining program | Low |
| 🤖 **AI weekly summary email** | **(V1.1)** ⭐ | AI-written weekly performance recap | Medium |
| **Monthly report email** | **(V1.1)** | Monthly summary | Medium |

## Payment & Account Emails 🆕

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Payment failed notification** | **(MVP)** 🆕 | Alert when payment fails | Low |
| **Payment reminder (Day 3)** | **(MVP)** 🆕 | First reminder | Low |
| **Payment warning (Day 5)** | **(MVP)** 🆕 | Warning before restriction | Low |
| **Account restricted notice** | **(MVP)** 🆕 | Notification of restriction | Low |
| **Account locked notice** | **(MVP)** 🆕 | Notification of lock | Low |
| **Payment restored confirmation** | **(MVP)** 🆕 | Confirmation when paid | Low |
| **Account deletion scheduled** | **(MVP)** 🆕 | Confirm deletion request | Low |
| **Account deletion reminder** | **(MVP)** 🆕 | Reminders at Day 7, 21, 29 | Low |
| **Account deleted confirmation** | **(MVP)** 🆕 | Final deletion confirmation | Low |

## Email Templates

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Pre-built email templates** | **(MVP)** ⭐ | Ready-to-use templates | Medium |
| 🤖 **AI email generation (3 per campaign)** | **(MVP)** ⭐ | AI writes 3 email variants | Medium |
| **Email template editor** | **(MVP)** | Edit template content | Medium |
| **Visual email builder** | **(V1.2)** | Drag-drop email design | High |
| **HTML email support** | **(MVP)** | Custom HTML emails | Medium |
| **Plain text fallback** | **(MVP)** | Text version | Low |
| **Dynamic personalization** | **(MVP)** ⭐ | Merge fields | Low |
| **Multi-language templates** | **(V1.1)** | DE/EN templates | Medium |
| **Template versioning** | **(V1.2)** | Track changes | Low |

## Email Campaigns (Nurture)

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Drip campaign builder** | **(V1.2)** | Automated sequences | High |
| **Re-engagement emails** | **(V1.1)** ⭐ | Activate dormant referrers | Medium |
| **Milestone celebration** | **(V1.1)** ⭐ | Celebrate achievements | Low |
| **Promotion announcements** | **(V1.1)** | Announce new rewards | Low |
| **Segmented campaigns** | **(V1.2)** | Target specific groups | Medium |
| 🤖 **AI send time optimization** | **(V2)** | Best time to send | Medium |

## In-App Notifications

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **In-product prompts** | **(MVP)** ⭐ | Prompt users to refer | Medium |
| **Smart trigger prompts** | **(V1.1)** ⭐ | Show at optimal moments | Medium |
| **Achievement popups** | **(V1.1)** | Celebrate in-app | Low |
| **Banner notifications** | **(V1.1)** | In-app banners | Low |
| **Push notifications** | **(V2)** | Mobile push | High |
| 🆕 **Payment warning banner** | **(MVP)** | Dashboard warning for payment issues | Low |

---

# 7️⃣ INTEGRATIONS 🔧

## Payment Integrations

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🔧 **Stripe integration** | **(MVP)** | Full Stripe sync | High |
| 🔧 **Paddle integration** | **(V1.1)** ⭐ | Paddle payments | High |
| 🔧 **Chargebee integration** | **(V1.2)** | Chargebee sync | High |
| 🔧 **Recurly integration** | **(V2)** | Recurly sync | High |
| 🔧 **Generic webhook** | **(MVP)** 🔧 | Any payment via webhook | Medium |

## CRM Integrations

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🔧 **HubSpot integration** | **(V1.1)** ⭐ | Sync contacts, deals | High |
| 🔧 **Salesforce integration** | **(V1.2)** | Sync to Salesforce | High |
| 🔧 **Pipedrive integration** | **(V1.2)** | Pipedrive sync | Medium |
| 🔧 **Close integration** | **(V2)** | Close CRM sync | Medium |
| 🔧 **Generic CRM webhook** | **(V1.1)** 🔧 | Any CRM via webhook | Medium |

## Marketing Integrations

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🔧 **Segment integration** | **(V1.1)** ⭐ | Event tracking | High |
| 🔧 **Mixpanel integration** | **(V1.2)** | Analytics events | Medium |
| 🔧 **Amplitude integration** | **(V1.2)** | Analytics events | Medium |
| 🔧 **Google Analytics** | **(V1.1)** ⭐ | GA4 events | Medium |
| 🔧 **Mailchimp integration** | **(V1.2)** | Email sync | Medium |
| 🔧 **ActiveCampaign** | **(V1.2)** | Email sync | Medium |
| 🔧 **Intercom integration** | **(V1.2)** | Customer data | Medium |

## Automation Integrations

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🔧 **Zapier integration** | **(V1.1)** ⭐ | Connect to 5000+ apps | High |
| 🔧 **Make (Integromat)** | **(V1.2)** | Advanced automation | Medium |
| 🔧 **n8n integration** | **(V2)** | Self-hosted automation | Medium |
| 🔧 **Native webhooks** | **(MVP)** 🔧 | Outgoing webhooks | Medium |

## Other Integrations

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🔧 **Slack notifications** | **(V1.1)** ⭐ | Slack alerts | Low |
| 🔧 **Discord notifications** | **(V1.2)** | Discord alerts | Low |
| 🔧 **Notion integration** | **(V2)** | Sync to Notion | Medium |
| 🔧 **Airtable integration** | **(V2)** | Sync to Airtable | Medium |

---

# 8️⃣ ANALYTICS & REPORTING

## Dashboard

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Overview dashboard** | **(MVP)** | Key metrics at glance | Medium |
| **Real-time stats** | **(MVP)** ⭐ | Live data updates | Medium |
| **Date range selector** | **(MVP)** | Filter by time period | Low |
| **Comparison periods** | **(V1.1)** ⭐ | Compare vs previous | Medium |
| **Custom dashboard** | **(V1.2)** | Build your own view | High |
| **Mobile dashboard** | **(V1.1)** | Mobile-optimized | Medium |
| 🤖 **AI insights panel** | **(V1.1)** | AI commentary on dashboard | Medium |
| 🤖 🆕 **Context-aware dashboard** | **(V2)** | Adapts to tenant state | High |

## Metrics & KPIs

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Total referrals** | **(MVP)** | Count of referrals | Low |
| **Referral conversion rate** | **(MVP)** | % that convert | Low |
| **Revenue generated** | **(MVP)** | Total referral revenue | Medium |
| **Referral ARR/MRR** | **(MVP)** ⭐ | Recurring revenue | Medium |
| **Active referrers** | **(MVP)** | Users who referred | Low |
| **Top referrers** | **(MVP)** ⭐ | Leaderboard | Low |
| **Average referral value** | **(MVP)** | Revenue per referral | Low |
| **Reward costs** | **(MVP)** | Total paid out | Low |
| **ROI calculation** | **(V1.1)** ⭐ | Revenue vs costs | Medium |
| **Viral coefficient** | **(V1.2)** | K-factor calculation | Medium |
| **Time to conversion** | **(V1.1)** | Average conversion time | Medium |
| **Channel performance** | **(MVP)** ⭐ | By sharing channel | Medium |
| **Campaign performance** | **(MVP)** | By campaign | Medium |
| **Cohort analysis** | **(V1.2)** | Performance over time | High |
| **Funnel visualization** | **(V1.1)** ⭐ | Referral funnel | Medium |

## Reports

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Pre-built reports** | **(MVP)** ⭐ | Standard report templates | Medium |
| **Custom report builder** | **(V1.2)** | Build custom reports | High |
| **Scheduled reports** | **(V1.1)** | Auto-send reports | Medium |
| **Export to CSV** | **(MVP)** | Download data | Low |
| **Export to Excel** | **(V1.1)** | Download as XLSX | Low |
| **PDF export** | **(V1.2)** | Download as PDF | Medium |
| 🤖 **AI report summaries** | **(V1.2)** | AI explains data | Medium |
| **Shareable report links** | **(V1.2)** | Share with stakeholders | Medium |
| 🤖 🆕 **AI-generated custom reports** | **(V2)** | Natural language to report | High |

---

# 9️⃣ PAYOUT & REWARDS MANAGEMENT

## Payout Methods

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **PayPal payouts** | **(MVP)** | Pay via PayPal | High |
| **Wise payouts** | **(V1.1)** ⭐ | Pay via Wise (cheaper for EU) | High |
| **Bank transfer (SEPA)** | **(V1.2)** | Direct bank transfer | High |
| **Stripe payouts** | **(V1.2)** | Pay via Stripe Connect | High |
| **Gift card payouts** | **(V2)** | Third-party gift cards | High |
| **In-app credit** | **(V1.1)** | Credit to account | Medium |
| **Cryptocurrency** | **(V2)** | BTC/ETH payouts | High |

## Payout Management

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Manual payout approval** | **(MVP)** | Review before paying | Medium |
| 🤖 🆕 **AI auto-approval** | **(MVP)** | Auto-approve low-risk | Medium |
| 🤖 🆕 **AI auto-escalation** | **(MVP)** | Flag high-risk for review | Medium |
| **Automatic payouts** | **(V1.1)** ⭐ | Pay automatically | High |
| **Payout thresholds** | **(MVP)** ⭐ | Minimum payout amount | Low |
| **Payout scheduling** | **(V1.1)** | Weekly/monthly payouts | Medium |
| **Bulk payouts** | **(MVP)** ⭐ | Pay multiple at once | Medium |
| **Payout history** | **(MVP)** | Track all payouts | Low |
| **Failed payout handling** | **(MVP)** | Retry failed payments | Medium |
| **Payout holds** | **(V1.1)** | Hold for fraud review | Low |

## Tax & Compliance

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Tax form collection** | **(V1.1)** ⭐ | W-9, W-8BEN collection | High |
| **KYC verification** | **(V1.2)** | Identity verification | High |
| **1099 generation** | **(V2)** | US tax forms | High |
| 🆕 **VAT number validation** | **(MVP)** ⭐ | VIES API integration | Medium |
| 🆕 **EU VAT reverse charge** | **(MVP)** | B2B VAT handling via Stripe Tax | Medium |
| **Tax reporting** | **(V1.1)** | Tax summaries | Medium |
| **Audit trail** | **(MVP)** ⭐ | Complete payment history | Medium |

---

# 🔟 USER MANAGEMENT

## Company Onboarding & Verification 🆕

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🆕 **Company information form** | **(MVP)** | Collect legal name, address, VAT | Medium |
| 🆕 **Onboarding wizard** | **(MVP)** | Guided setup after signup | Medium |
| 🆕 **Country-specific validation** | **(MVP)** | Required fields by country | Medium |
| 🆕 **VIES VAT validation** | **(MVP)** ⭐ | EU VAT auto-verification | High |
| 🆕 **VAT validation caching** | **(MVP)** | 30-day cache for VIES results | Low |
| 🆕 **Verification status display** | **(MVP)** | Show verified/pending/failed | Low |
| 🆕 **Manual verification queue** | **(MVP)** | Admin review for non-EU | Medium |
| 🆕 **Onboarding enforcement** | **(MVP)** | Block paid features if incomplete | Medium |
| 🆕 **Stripe VAT sync** | **(MVP)** | Pass validated VAT to Stripe | Low |
| 🆕 **Company registry links** | **(V1.1)** | Handelsregister, Zefix, etc. | Low |
| 🆕 **Domain verification** | **(V1.2)** | Verify company domain ownership | Medium |
| 🆕 **Bulk company verification** | **(V2)** | Mass verify during import | Medium |

## Referrer Portal

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Referrer dashboard** | **(MVP)** | User's referral stats | Medium |
| **Referral link access** | **(MVP)** | Get/copy links | Low |
| **Earnings display** | **(MVP)** | Show current earnings | Low |
| **Payout history** | **(MVP)** | Past payouts | Low |
| **Referral history** | **(MVP)** | List of referrals | Medium |
| **Profile settings** | **(MVP)** | Update payout info | Medium |
| **Notification preferences** | **(V1.1)** | Control emails | Low |
| **Resources/assets** | **(V1.1)** ⭐ | Marketing materials | Medium |
| **Leaderboard access** | **(V1.2)** | See rankings | Low |
| 🆕 **GDPR data request** | **(MVP)** | Request data export/deletion | Medium |

## Admin Portal

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **User management** | **(MVP)** | View/manage referrers | Medium |
| **User search/filter** | **(MVP)** | Find specific users | Medium |
| **User detail view** | **(MVP)** | Individual user stats | Medium |
| **Manual reward adjustment** | **(MVP)** ⭐ | Add/remove rewards | Low |
| **User status management** | **(MVP)** | Activate/deactivate | Low |
| **Bulk user actions** | **(V1.1)** | Actions on multiple users | Medium |
| **User segmentation** | **(V1.2)** | Create user segments | Medium |
| **User export** | **(MVP)** | Export user data | Low |
| **User import** | **(V1.1)** | Import existing referrers | Medium |

## Team & Permissions

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Team member invites** | **(MVP)** ⭐ | Add team members | Medium |
| **Role-based access** | **(MVP)** ⭐ | Admin, editor, viewer | Medium |
| **Custom permissions** | **(V1.2)** | Granular access control | High |
| **SSO/SAML** | **(V2)** | Enterprise SSO | High |
| **Audit log** | **(V1.1)** ⭐ | Track team actions | Medium |
| **Two-factor auth** | **(MVP)** ⭐ | 2FA for admins | Medium |
| 🆕 **Member removal with data handling** | **(MVP)** | Proper offboarding | Medium |

---

# 1️⃣1️⃣ API & DEVELOPER TOOLS 🔧

## REST API

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🔧 **Full REST API** | **(MVP)** | Complete API access | High |
| 🔧 **API authentication** | **(MVP)** | API keys, OAuth | Medium |
| 🔧 **Rate limiting** | **(MVP)** | Fair usage limits | Medium |
| 🔧 **API versioning** | **(MVP)** ⭐ | v1, v2 support | Medium |
| 🔧 **Pagination** | **(MVP)** | Paginated responses | Low |
| 🔧 **Filtering/sorting** | **(MVP)** | Query parameters | Medium |
| 🔧 **Error handling** | **(MVP)** | Clear error messages | Low |
| 🔧 **Sandbox/test mode** | **(MVP)** ⭐ | Test without production | Medium |

## Webhooks

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🔧 **Outgoing webhooks** | **(MVP)** | Events to your server | Medium |
| 🔧 **Webhook management UI** | **(MVP)** | Configure in dashboard | Medium |
| 🔧 **Webhook signatures** | **(MVP)** ⭐ | Verify authenticity | Low |
| 🔧 **Webhook retry** | **(MVP)** | Auto-retry failed | Medium |
| 🔧 **Webhook logs** | **(MVP)** ⭐ | View webhook history | Medium |
| 🔧 **Webhook testing** | **(MVP)** ⭐ | Test endpoint | Low |
| 🔧 **Custom webhook events** | **(V1.1)** | Select which events | Low |

## Developer Experience

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🔧 **API documentation** | **(MVP)** | Comprehensive docs | High |
| 🔧 **Interactive API explorer** | **(MVP)** ⭐ | Try API in browser | Medium |
| 🔧 **Code examples** | **(MVP)** ⭐ | JS, Python, Ruby, etc. | Medium |
| 🔧 **Postman collection** | **(MVP)** ⭐ | Ready-to-use collection | Low |
| 🔧 **OpenAPI/Swagger spec** | **(MVP)** ⭐ | Standard API spec | Medium |
| 🔧 **CLI tool** | **(V1.2)** | Command line interface | Medium |
| 🔧 **Developer changelog** | **(MVP)** ⭐ | Track API changes | Low |
| 🔧 **Status page** | **(V1.1)** | API status monitoring | Low |

---

# 1️⃣2️⃣ SECURITY & COMPLIANCE

## Security Features

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **HTTPS everywhere** | **(MVP)** | SSL/TLS encryption | Included |
| **Data encryption at rest** | **(MVP)** | Encrypted database | Medium |
| **Two-factor authentication** | **(MVP)** ⭐ | 2FA for accounts | Medium |
| **Session management** | **(MVP)** | Secure sessions | Medium |
| **Password requirements** | **(MVP)** | Strong password rules | Low |
| **Brute force protection** | **(MVP)** | Rate limit logins | Low |
| **IP allowlisting** | **(V1.2)** | Restrict by IP | Low |
| **Security headers** | **(MVP)** | CSP, HSTS, etc. | Low |
| **Vulnerability scanning** | **(V1.1)** | Regular scans | Medium |
| **Penetration testing** | **(V1.2)** | Annual pen test | High |

## Fraud Prevention

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Duplicate detection** | **(MVP)** | Detect duplicate referrals | Medium |
| **Self-referral prevention** | **(MVP)** | Block self-referrals | Medium |
| **IP-based detection** | **(MVP)** ⭐ | Flag same IP referrals | Medium |
| **Device fingerprinting** | **(V1.1)** | Detect same device | High |
| **Velocity checks** | **(MVP)** 🆕 | Unusual activity detection | Medium |
| 🤖 **AI fraud detection** | **(MVP)** 🆕 ⭐ | ML-based detection | High |
| **Manual review queue** | **(MVP)** ⭐ | Flag for review | Medium |
| **Fraud rules engine** | **(V1.2)** | Custom fraud rules | High |
| **Referral verification** | **(V1.1)** | Verify before reward | Medium |

## Compliance

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **GDPR compliance** | **(MVP)** | EU data protection | High |
| **Data export (GDPR)** | **(MVP)** | Export user data | Medium |
| **Data deletion (GDPR)** | **(MVP)** | Delete user data | Medium |
| **Cookie consent** | **(MVP)** | Cookie banner | Medium |
| **Privacy policy integration** | **(MVP)** | Link to privacy policy | Low |
| **DPA template** | **(MVP)** ⭐ | Data processing agreement | Low |
| **CCPA compliance** | **(V1.1)** | California privacy | Medium |
| **SOC 2 preparation** | **(V1.2)** | Security certification | High |
| **Data residency (EU)** | **(MVP)** ⭐ | EU-only hosting | Medium |
| 🆕 **Data retention automation** | **(MVP)** | Auto-delete old data | Medium |
| 🆕 **Referrer GDPR deletion** | **(MVP)** | Referrer data deletion request | Medium |

---

# 1️⃣3️⃣ PLATFORM & INFRASTRUCTURE

## Account Lifecycle 🆕

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| 🆕 **Payment failure handling** | **(MVP)** | Detect and handle failed payments | Medium |
| 🆕 **Grace period (7 days)** | **(MVP)** | Past due → restricted | Low |
| 🆕 **Account restriction (Day 7-21)** | **(MVP)** | Read-only access | Medium |
| 🆕 **Account locking (Day 21+)** | **(MVP)** | No access, campaigns paused | Medium |
| 🆕 **Payment restoration** | **(MVP)** | Immediate restore on payment | Medium |
| 🆕 **Account deletion (30-day grace)** | **(MVP)** | GDPR-compliant deletion | High |
| 🆕 **Deletion cancellation** | **(MVP)** | Cancel pending deletion | Low |
| 🆕 **Cross-service deletion** | **(MVP)** | Delete from all services | High |

## Multi-tenancy

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **Account isolation** | **(MVP)** | Data separation | High |
| 🆕 **Wildcard subdomain** | **(MVP)** | *.referralapp.io | Low |
| **Custom subdomains** | **(V1.1)** | company.platform.com | Medium |
| **Custom domains** | **(V1.1)** ⭐ | refer.company.com | Medium |
| **White-labeling** | **(V1.2)** | Remove platform branding | Medium |

## Performance

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **CDN for assets** | **(MVP)** | Fast global delivery | Medium |
| **Database optimization** | **(MVP)** | Indexed queries | Medium |
| **Caching layer** | **(MVP)** | Redis caching | Medium |
| **Auto-scaling** | **(V1.1)** | Handle traffic spikes | High |
| **99.9% uptime SLA** | **(V1.2)** | Enterprise SLA | - |

## Localization

| Feature | Priority | Description | Effort |
|---------|----------|-------------|--------|
| **English language** | **(MVP)** | Default language | Included |
| **German language** | **(MVP)** ⭐ | Full German UI | Medium |
| **French language** | **(V1.2)** | Full French UI | Medium |
| **Multi-currency display** | **(MVP)** ⭐ | EUR, USD, GBP, CHF | Low |
| **Date/time localization** | **(MVP)** | Regional formats | Low |
| **Number formatting** | **(MVP)** | Regional formats | Low |

---

# 📊 MVP Feature Summary v3.0

## Total Feature Count

| Category | MVP | Total |
|----------|-----|-------|
| Referral Tracking | 14 | 24 |
| Campaign Management | 18 | 32 |
| AI Features | 28 | 52 |
| Widget & SDK | 26 | 40 |
| Landing Pages | 5 | 15 |
| Email & Notifications | 22 | 38 |
| Integrations | 4 | 25 |
| Analytics | 13 | 28 |
| Payouts | 12 | 24 |
| User Management | 24 🆕 | 38 🆕 |
| API & Developer | 18 | 25 |
| Security & Compliance | 20 | 32 |
| Platform | 14 | 21 |
| **TOTAL** | **~218** 🆕 | **~394** 🆕 |

---

# 🆕 Key Changes from v2.0

## Added to MVP

| Feature | Reason |
|---------|--------|
| AI Reward Risk Scoring | Reduce manual review, prevent fraud |
| AI Auto-Approval | Scale without manual work |
| AI Fraud Detection | Core protection, differentiator |
| Payment Failure Handling | Business critical |
| Account Restriction/Locking | Revenue protection |
| GDPR Data Export | Legal requirement |
| GDPR Account Deletion | Legal requirement |
| Data Retention Automation | Compliance |
| Payment Notification Emails | Customer communication |
| Wildcard Subdomain | Simpler than custom domains |
| **Company Information Form** 🆕 | B2B compliance, proper invoicing |
| **Onboarding Wizard** 🆕 | Guide customers through setup |
| **VIES VAT Validation** 🆕 | EU B2B reverse charge requirement |
| **Verification Status** 🆕 | Customer transparency |
| **Manual Verification Queue** 🆕 | Handle Swiss/non-EU companies |
| **Onboarding Enforcement** 🆕 | Ensure data collection |

## Moved from V1.1 to MVP

| Feature | Reason |
|---------|--------|
| Velocity checks (fraud) | Part of AI fraud detection |
| AI fraud detection | Core risk management |
| **VAT number validation** 🆕 | Required for EU B2B invoicing |
| **EU VAT reverse charge** 🆕 | Legal requirement for B2B |

## Deferred to V1.1

| Feature | Reason |
|---------|--------|
| Custom domains | Wildcard subdomain sufficient for MVP |
| Subdomain management | Just a DB field with wildcard |
| **Self-lock feature** 🆕 | Removed - no valid use case |

## New AI Capabilities (V1.1-V2)

| Feature | Priority |
|---------|----------|
| Natural language queries | V1.2 |
| AI visualization selection | V1.2 |
| Dynamic report generation | V1.2 |
| Root cause analysis | V1.2 |
| Context-aware dashboards | V2 |
| Conversational analytics | V2 |
| Autopilot mode | V2 |

---

**Document Version:** 3.0  
**Updated:** December 2024  
**Previous Version:** 2.0  
**Next Review:** Pre-launch
