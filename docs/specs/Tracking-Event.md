# Referral Platform Event Tracking Spec (v1)

_Generated 2025-09-11_

This document defines the **production contract** for events tracked by your referral marketing platform.


---

## 1) Envelope (top-level fields on every event)

| Field | Type | Required | Used for / Description |
|---|---|---|---|
| event | string (enum: event names below) | Yes | Event name; drives per-event validation and routing. |
| event_id | string (UUIDv4) | Yes | Idempotency key per (client_id, campaign_id). |
| occurred_at | string (ISO-8601 UTC) | Yes | Client-side timestamp when the action happened. |
| client_id | string | Yes | Tenant identifier (your customer). |
| campaign_id | string | Yes | Campaign identifier within the client. |
| received_at | string (ISO-8601 UTC) | No | Server ingest timestamp. |
| participant.participant_id | string | No | Your internal participant key (scoped to campaign). |
| participant.external_user_id_hash | string | No | Stable hash of client's user identifier (email/user id). |
| participant.anonymous_id | string | No | Anonymous device/browser id before login. |
| participant.session_id | string | No | Session correlation id. |
| referral.referral_id | string | No | Primary key linking referrer↔referred journeys. |
| referral.invite_id | string | No | Unique id for an invite attempt. |
| referral.visit_id | string | No | Unique id for a referral click/landing. |
| sdk.name | string | No | SDK name (web, ios, android, backend). |
| sdk.version | string | No | SDK version. |
| app.platform | string ("web"|"ios"|"android"|"backend") | No | App runtime platform. |
| app.app_version | string | No | App version. |
| app.build | string | No | Build/revision. |
| device.os | string | No | Operating system. |
| device.os_version | string | No | OS version. |
| device.model | string | No | Device model. |
| device.browser | string | No | Browser name (web). |
| device.user_agent | string | No | Full user agent (web). |
| device.screen | string | No | Screen size, e.g., 1440x900. |
| locale.language | string (BCP-47) | No | Display language (e.g., en-US). |
| locale.timezone | string (IANA) | No | Timezone (e.g., Europe/Brussels). |
| page.url | string (URL) | No | Page URL (web). |
| page.referrer | string (URL) | No | Referrer URL (web). |
| page.title | string | No | Document/page title (web). |
| page.path | string | No | Path component of URL (web). |
| geo.ip | string (hashed/redacted) | No | IP address (hashed/redacted per policy). |
| geo.country | string (ISO-3166-1 alpha-2) | No | Country code (e.g., BE). |
| geo.region | string | No | Region/state name. |
| geo.city | string | No | City name. |
| marketing.utm_source | string | No | UTM source. |
| marketing.utm_medium | string | No | UTM medium. |
| marketing.utm_campaign | string | No | UTM campaign. |
| marketing.utm_term | string | No | UTM term. |
| marketing.utm_content | string | No | UTM content. |
| marketing.gclid | string | No | Google Click ID if present. |
| marketing.fbclid | string | No | Facebook Click ID if present. |
| marketing.first_touch.acquisition_channel | string | No | Derived first-touch channel (write-once). |
| marketing.first_touch.utm_source | string | No | First-touch UTM source. |
| marketing.first_touch.utm_medium | string | No | First-touch UTM medium. |
| marketing.first_touch.utm_campaign | string | No | First-touch UTM campaign. |
| marketing.first_touch.first_referrer | string (URL) | No | First referrer URL observed. |
| marketing.first_touch.first_landing_url | string (URL) | No | First landing URL observed. |
| marketing.first_touch.first_seen_at | string (ISO-8601 UTC) | No | Timestamp of first-touch capture. |
| experiments[].experiment_id | string | No | Experiment identifier. |
| experiments[].variant_id | string | No | Variant identifier. |
| traits_inline_optional.plan | string | No | User trait: current plan. |
| traits_inline_optional.country | string (ISO-3166-1) | No | User trait: country. |
| traits_inline_optional.language | string (BCP-47) | No | User trait: language. |
| traits_inline_optional.acquisition_channel | string | No | User trait: acquisition channel. |
| traits_inline_optional.customer_tier | string | No | User trait: tier (bronze/silver/gold/...). |
| traits_inline_optional.is_employee | boolean | No | User trait: internal employee flag. |
| ctx_participant.plan | string | No | Stamped trait for segmentation: plan. |
| ctx_participant.country | string (ISO-3166-1) | No | Stamped trait: country. |
| ctx_participant.language | string (BCP-47) | No | Stamped trait: language. |
| ctx_participant.acquisition_channel | string | No | Stamped trait: acquisition channel. |
| ctx_participant.customer_tier | string | No | Stamped trait: customer tier. |
| ctx_participant.is_employee | boolean | No | Stamped trait: employee flag. |
| ctx_participant.plan_since | string (date) | No | Since when current plan is active. |
| ctx_participant.tier_since | string (date) | No | Since when current tier is active. |
| properties | object | Yes | Event-specific payload (see catalog). |


### Minimal Event JSON (envelope template)

```json
{
  "event": "<event_name>",
  "event_id": "<uuid-v4>",
  "occurred_at": "YYYY-MM-DDThh:mm:ss.sssZ",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": { "external_user_id_hash": "<sha256>", "anonymous_id": "<anon>", "session_id": "<session>" },
  "referral": { "referral_id": "<ref_id>", "invite_id": "<invite_id>", "visit_id": "<visit_id>" },
  "properties": { }
}
```


---

## 2) Event Catalog (with JSON template per event)


### `widget_appeared`

Referral widget became visible to the user.


```json
{
  "event": "widget_appeared",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "widget_id": "<string>",
    "placement": "<string>",
    "template_version": "<string>",
    "trigger": "<string>",
    "load_time_ms": 0,
    "visibility_pct": 0,
    "page_section": "<string>",
    "ab_slot": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| widget_id | string | Mandatory | Widget identifier |
| placement | "modal"|"banner"|"inline"|"floating" | Mandatory | UI placement |
| template_version | string | Mandatory | Widget template/version used |
| trigger | "autoload"|"scroll"|"exit_intent"|"manual" | Optional | How the widget opened |
| load_time_ms | integer ≥ 0 | Optional | Widget load performance |
| visibility_pct | integer 0–100 | Optional | Viewport visibility percentage |
| page_section | string | Optional | Page area hosting the widget |
| ab_slot | string | Optional | Experiment slot name if multiple |



### `widget_email_filled`

User filled an email/phone field in the widget.


```json
{
  "event": "widget_email_filled",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "widget_id": "<string>",
    "email_sha256": "<string>",
    "phone_sha256": "<string>",
    "email_domain": "<string>",
    "time_to_fill_ms": 0,
    "validation_result": "<string>",
    "fields_present": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| widget_id | string | Mandatory | Widget identifier |
| email_sha256 | string | Optional | Hashed email (no raw PII) |
| phone_sha256 | string | Optional | Hashed phone |
| email_domain | string | Optional | Derived email domain |
| time_to_fill_ms | integer ≥ 0 | Optional | Time to fill field |
| validation_result | "valid"|"invalid"|"disposable"|"unknown" | Optional | Validation outcome |
| fields_present | string[] | Optional | Other fields visible at submit |



### `widget_submitted`

User submitted the widget.


```json
{
  "event": "widget_submitted",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "widget_id": "<string>",
    "is_success": false,
    "submit_latency_ms": 0,
    "method": "<string>",
    "error_code": "<string>",
    "error_message": "<string>",
    "fields_present": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| widget_id | string | Mandatory | Widget identifier |
| is_success | boolean | Mandatory | Submission accepted vs failed |
| submit_latency_ms | integer ≥ 0 | Optional | Submit roundtrip time |
| method | "email"|"phone"|"oauth"|"link" | Optional | Auth/submit method |
| error_code | string | Optional | Failure reason code |
| error_message | string | Optional | Human message (short) |
| fields_present | string[] | Optional | Fields included at submit |



### `widget_closed`

User closed the widget.


```json
{
  "event": "widget_closed",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "widget_id": "<string>",
    "close_reason": "<string>",
    "visible_ms": 0
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| widget_id | string | Mandatory | Widget identifier |
| close_reason | "dismiss"|"timeout"|"converted"|"outside_click"|"escape_key" | Mandatory | Why it closed |
| visible_ms | integer ≥ 0 | Optional | Time visible before closing |



### `invitation_sent`

An invite was created and sent via a channel.


```json
{
  "event": "invitation_sent",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "referral_id": "<string>",
    "invite_id": "<string>",
    "channel": "<string>",
    "destination": "<string>",
    "message_template_id": "<string>",
    "invitee_email_domain": "<string>",
    "invitee_phone_cc": "<string>",
    "link_url": "<string>",
    "short_link": false
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| referral_id | string | Mandatory | Referral relationship id |
| invite_id | string | Mandatory | Unique invite id |
| channel | "email"|"sms"|"link"|"whatsapp"|"messenger"|"copy" | Mandatory | Send medium |
| destination | string(masked) | Optional | Masked recipient address |
| message_template_id | string | Optional | Template used |
| invitee_email_domain | string | Optional | Invitee's email domain |
| invitee_phone_cc | string | Optional | Invitee phone country code |
| link_url | string | Optional | Invite link issued |
| short_link | boolean | Optional | Was a short link used |



### `invitation_delivered`

Delivery status from provider.


```json
{
  "event": "invitation_delivered",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "referral_id": "<string>",
    "invite_id": "<string>",
    "channel": "<string>",
    "delivery_status": "<string>",
    "provider_message_id": "<string>",
    "reason": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| referral_id | string | Mandatory | Referral id |
| invite_id | string | Mandatory | Invite id |
| channel | "email"|"sms"|"link"|"whatsapp"|"messenger"|"copy" | Mandatory | Medium |
| delivery_status | "sent"|"bounced"|"blocked"|"throttled" | Mandatory | Outcome |
| provider_message_id | string | Optional | Upstream provider id |
| reason | string | Optional | Optional reason text |



### `invitation_clicked`

Invitee clicked the referral link.


```json
{
  "event": "invitation_clicked",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "referral_id": "<string>",
    "invite_id": "<string>",
    "visit_id": "<string>",
    "landing_url": "<string>",
    "gclid": "<string>",
    "fbclid": "<string>",
    "device_fingerprint": "<string>",
    "first_click": false
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| referral_id | string | Mandatory | Referral id |
| invite_id | string | Mandatory | Invite id |
| visit_id | string | Mandatory | Visit/click id |
| landing_url | string | Mandatory | Landing URL |
| gclid | string | Optional | Google click id |
| fbclid | string | Optional | Facebook click id |
| device_fingerprint | string | Optional | Visitor fingerprint |
| first_click | boolean | Optional | Was this their first click |



### `referred_visited`

Referred visitor landed on site/app.


```json
{
  "event": "referred_visited",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "referral_id": "<string>",
    "visit_id": "<string>",
    "first_visit": false,
    "landing_url": "<string>",
    "landing_path": "<string>",
    "device_fingerprint": "<string>",
    "cookie_present": false,
    "utm_source": "<string>",
    "utm_medium": "<string>",
    "utm_campaign": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| referral_id | string | Mandatory | Referral id |
| visit_id | string | Mandatory | Visit id |
| first_visit | boolean | Mandatory | Is this the first time for this user |
| landing_url | string | Optional | Landing URL |
| landing_path | string | Optional | Landing path |
| device_fingerprint | string | Optional | Visitor fingerprint |
| cookie_present | boolean | Optional | Referral cookie found |
| utm_source | string | Optional | Inline UTM source |
| utm_medium | string | Optional | Inline UTM medium |
| utm_campaign | string | Optional | Inline UTM campaign |



### `referred_signed_up`

Referred visitor completed signup (legacy name).


```json
{
  "event": "referred_signed_up",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "referral_id": "<string>",
    "signup_method": "<string>",
    "is_new_account": false,
    "referred_participant_id": "<string>",
    "external_user_id_hash": "<string>",
    "plan": "<string>",
    "country": "<string>",
    "language": "<string>",
    "marketing_opt_in": false,
    "signup_step_ms": 0,
    "coupon_code": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| referral_id | string | Mandatory | Referral id |
| signup_method | "email"|"oauth"|"sso"|"phone" | Mandatory | Signup method |
| is_new_account | boolean | Mandatory | True if account newly created |
| referred_participant_id | string | Optional | Internal participant id |
| external_user_id_hash | string | Optional | Hashed client user id |
| plan | string | Optional | Initial plan at signup |
| country | string (ISO-3166-1) | Optional | Country at signup |
| language | string (BCP-47) | Optional | Language at signup |
| marketing_opt_in | boolean | Optional | Consent flag |
| signup_step_ms | integer ≥ 0 | Optional | Time from start to signup |
| coupon_code | string | Optional | Promo used at signup |



### `referred_made_signup`

Referred participant completed signup (canonical).


```json
{
  "event": "referred_made_signup",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "referral_id": "<string>",
    "signup_method": "<string>",
    "is_new_account": false,
    "referred_participant_id": "<string>",
    "external_user_id_hash": "<string>",
    "plan": "<string>",
    "country": "<string>",
    "language": "<string>",
    "marketing_opt_in": false,
    "signup_step_ms": 0,
    "coupon_code": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| referral_id | string | Mandatory | Referral id |
| signup_method | "email"|"oauth"|"sso"|"phone" | Mandatory | Signup method |
| is_new_account | boolean | Mandatory | True if new account (vs linking) |
| referred_participant_id | string | Optional | Internal participant id |
| external_user_id_hash | string | Optional | Hashed client user id |
| plan | string | Optional | Initial plan at signup |
| country | string (ISO-3166-1) | Optional | Country at signup |
| language | string (BCP-47) | Optional | Language at signup |
| marketing_opt_in | boolean | Optional | Consent flag |
| signup_step_ms | integer ≥ 0 | Optional | Time from start to signup |
| coupon_code | string | Optional | Promo used at signup |



### `referred_made_reactivate_account`

Referred participant reactivated a paused/canceled account.


```json
{
  "event": "referred_made_reactivate_account",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "referral_id": "<string>",
    "reason": "<string>",
    "referred_participant_id": "<string>",
    "external_user_id_hash": "<string>",
    "reactivation_path": "<string>",
    "plan_at_reactivation": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| referral_id | string | Mandatory | Referral id |
| reason | "user_request"|"auto_billing_recovery"|"support_override"|"other" | Mandatory | Why it reactivated |
| referred_participant_id | string | Optional | Internal participant id |
| external_user_id_hash | string | Optional | Hashed client user id |
| reactivation_path | "self_service"|"support"|"dunning" | Optional | Path to reactivation |
| plan_at_reactivation | string | Optional | Plan active after reactivation |



### `referred_made_adopt_new_features`

Referred participant adopted a feature (met adoption criteria).


```json
{
  "event": "referred_made_adopt_new_features",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "referral_id": "<string>",
    "feature_key": "<string>",
    "adoption_criteria": "<string>",
    "referred_participant_id": "<string>",
    "external_user_id_hash": "<string>",
    "time_to_adoption_ms": 0,
    "prior_usage_count": 0,
    "cohort_rule_id": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| referral_id | string | Mandatory | Referral id |
| feature_key | string | Mandatory | Feature identifier |
| adoption_criteria | string | Mandatory | Rule used (e.g., first_success, 3_uses_7d) |
| referred_participant_id | string | Optional | Internal participant id |
| external_user_id_hash | string | Optional | Hashed client user id |
| time_to_adoption_ms | integer ≥ 0 | Optional | Time from discover to adoption |
| prior_usage_count | integer ≥ 0 | Optional | Usage count prior to adoption |
| cohort_rule_id | string | Optional | Cohort rule id if computed |



### `referred_made_purchase`

Referred participant placed an order.


```json
{
  "event": "referred_made_purchase",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "referral_id": "<string>",
    "order_id": "<string>",
    "amount": 0,
    "currency": "<string>",
    "referred_participant_id": "<string>",
    "external_user_id_hash": "<string>",
    "items_count": 0,
    "subtotal": 0,
    "tax": 0,
    "shipping": 0,
    "discount": 0,
    "is_first_purchase": false,
    "payment_method": "<string>",
    "coupon_code": "<string>",
    "products": 0
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| referral_id | string | Mandatory | Referral id |
| order_id | string | Mandatory | Client order id |
| amount | number | Mandatory | Final charged amount |
| currency | string (ISO-4217) | Mandatory | Currency code |
| referred_participant_id | string | Optional | Internal participant id |
| external_user_id_hash | string | Optional | Hashed client user id |
| items_count | integer ≥ 0 | Optional | Number of items |
| subtotal | number | Optional | Subtotal before tax/discount |
| tax | number | Optional | Tax amount |
| shipping | number | Optional | Shipping amount |
| discount | number | Optional | Discount amount |
| is_first_purchase | boolean | Optional | First order flag |
| payment_method | "card"|"paypal"|"apple_pay"|"google_pay"|"bank"|"other" | Optional | Payment type |
| coupon_code | string | Optional | Promo code |
| products | array of { sku:string, qty:int≥1, unit_price:number, name?:string } | Optional | Line items detail |



### `referrer_made_purchase`

Referrer placed an order (for self).


```json
{
  "event": "referrer_made_purchase",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "order_id": "<string>",
    "amount": 0,
    "currency": "<string>",
    "referrer_participant_id": "<string>",
    "external_user_id_hash": "<string>",
    "items_count": 0,
    "subtotal": 0,
    "tax": 0,
    "shipping": 0,
    "discount": 0,
    "is_first_purchase": false,
    "payment_method": "<string>",
    "coupon_code": "<string>",
    "products": 0
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| order_id | string | Mandatory | Client order id |
| amount | number | Mandatory | Final charged amount |
| currency | string (ISO-4217) | Mandatory | Currency code |
| referrer_participant_id | string | Optional | Internal participant id |
| external_user_id_hash | string | Optional | Hashed client user id |
| items_count | integer ≥ 0 | Optional | Number of items |
| subtotal | number | Optional | Subtotal before tax/discount |
| tax | number | Optional | Tax amount |
| shipping | number | Optional | Shipping amount |
| discount | number | Optional | Discount amount |
| is_first_purchase | boolean | Optional | First order flag |
| payment_method | "card"|"paypal"|"apple_pay"|"google_pay"|"bank"|"other" | Optional | Payment type |
| coupon_code | string | Optional | Promo code |
| products | array of { sku:string, qty:int≥1, unit_price:number, name?:string } | Optional | Line items detail |



### `referral_reward_issued`

Reward was issued or revoked for a referral.


```json
{
  "event": "referral_reward_issued",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "referral_id": "<string>",
    "referrer_participant_id": "<string>",
    "reward_rule_id": "<string>",
    "reward_type": "<string>",
    "reward_value": 0,
    "status": "<string>",
    "referred_participant_id": "<string>",
    "reason": "<string>",
    "wallet_txn_id": "<string>",
    "expires_at": "<iso-8601>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| referral_id | string | Mandatory | Referral id |
| referrer_participant_id | string | Mandatory | Referrer participant id |
| reward_rule_id | string | Mandatory | Rule id that triggered reward |
| reward_type | "credit"|"coupon"|"cash"|"points" | Mandatory | Type of reward |
| reward_value | number | Mandatory | Value of reward |
| status | "issued"|"revoked" | Mandatory | Reward status |
| referred_participant_id | string | Optional | Referred participant id |
| reason | string | Optional | Reason text |
| wallet_txn_id | string | Optional | Wallet transaction id |
| expires_at | string (ISO-8601 UTC) | Optional | Reward expiry |



### `subscription_renewed`

Subscription renewed for a billing period.


```json
{
  "event": "subscription_renewed",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "subscription_id": "<string>",
    "period_start": "<iso-8601>",
    "period_end": "<iso-8601>",
    "amount": 0,
    "currency": "<string>",
    "billing_provider": "<string>",
    "renewal_type": "<string>",
    "status": "<string>",
    "failure_code": "<string>",
    "coupon_code": "<string>",
    "subtotal": 0,
    "tax": 0,
    "shipping": 0,
    "discount": 0
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| subscription_id | string | Mandatory | Subscription id |
| period_start | string (ISO-8601 UTC) | Mandatory | Start of new period |
| period_end | string (ISO-8601 UTC) | Mandatory | End of new period |
| amount | number | Mandatory | Charge amount |
| currency | string (ISO-4217) | Mandatory | Currency code |
| billing_provider | "stripe"|"braintree"|"paddle"|"adyen"|"apple"|"google"|"other" | Optional | Billing provider |
| renewal_type | "auto"|"manual" | Optional | How renewal occurred |
| status | "success"|"failed" | Optional | Renewal status |
| failure_code | string | Optional | Failure code if any |
| coupon_code | string | Optional | Promo applied |
| subtotal | number | Optional | Subtotal |
| tax | number | Optional | Tax |
| shipping | number | Optional | Shipping |
| discount | number | Optional | Discount |



### `account_reactivated`

Previously canceled/paused account reactivated.


```json
{
  "event": "account_reactivated",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "reason": "<string>",
    "reactivation_path": "<string>",
    "plan_at_reactivation": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| reason | "user_request"|"auto_billing_recovery"|"support_override"|"other" | Mandatory | Why it reactivated |
| reactivation_path | "self_service"|"support"|"dunning" | Optional | Path to reactivation |
| plan_at_reactivation | string | Optional | Plan after reactivation |



### `plan_upgraded`

Plan upgraded to a higher SKU or tier.


```json
{
  "event": "plan_upgraded",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "previous_plan": "<string>",
    "new_plan": "<string>",
    "effective_at": "<iso-8601>",
    "proration_amount": 0,
    "currency": "<string>",
    "payment_method": "<string>",
    "seats_before": 0,
    "seats_after": 0
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| previous_plan | string | Mandatory | Plan before upgrade |
| new_plan | string | Mandatory | Plan after upgrade |
| effective_at | string (ISO-8601 UTC) | Mandatory | When upgrade took effect |
| proration_amount | number | Optional | Proration charge/credit |
| currency | string (ISO-4217) | Optional | Currency code |
| payment_method | "card"|"paypal"|"apple_pay"|"google_pay"|"bank"|"other" | Optional | Payment type |
| seats_before | integer ≥ 0 | Optional | Seats before |
| seats_after | integer ≥ 0 | Optional | Seats after |



### `survey_shown`

Survey UI presented to the user.


```json
{
  "event": "survey_shown",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "survey_id": "<string>",
    "template": "<string>",
    "channel": "<string>",
    "ab_slot": "<string>",
    "question_count": 0
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| survey_id | string | Mandatory | Survey identifier |
| template | "nps"|"csat"|"ces"|"custom" | Mandatory | Survey template |
| channel | "in_app"|"web"|"email_link"|"mobile" | Mandatory | Delivery channel |
| ab_slot | string | Optional | Experiment slot |
| question_count | integer ≥ 0 | Optional | Number of questions |



### `survey_started`

User started answering the survey.


```json
{
  "event": "survey_started",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "survey_id": "<string>",
    "time_to_first_action_ms": 0
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| survey_id | string | Mandatory | Survey identifier |
| time_to_first_action_ms | integer ≥ 0 | Optional | Time to first action |



### `survey_submitted`

User submitted survey responses.


```json
{
  "event": "survey_submitted",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "survey_id": "<string>",
    "response_id": "<string>",
    "answers": 0,
    "duration_ms": 0,
    "score_overall": 0,
    "comment": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| survey_id | string | Mandatory | Survey identifier |
| response_id | string | Mandatory | Unique response id |
| answers | array of { question_id:string, type:"nps"|"csat"|"ces"|"single_choice"|"multi_choice"|"open_text"|"number"|"boolean", value?:number, option_id?:string, text?:string } | Mandatory | Answers list |
| duration_ms | integer ≥ 0 | Optional | Time to complete |
| score_overall | number | Optional | Aggregate score (for CSAT/CES/NPS) |
| comment | string | Optional | Overall comment |



### `survey_abandoned`

Survey was abandoned before completion.


```json
{
  "event": "survey_abandoned",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "survey_id": "<string>",
    "progress_pct": 0,
    "last_question_id": "<string>",
    "duration_ms": 0
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| survey_id | string | Mandatory | Survey identifier |
| progress_pct | integer 0–100 | Optional | Completion percent |
| last_question_id | string | Optional | Last question touched |
| duration_ms | integer ≥ 0 | Optional | Time before abandonment |



### `newsletter_subscribed`

Contact subscribed to a mailing list.


```json
{
  "event": "newsletter_subscribed",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "list_id": "<string>",
    "source": "<string>",
    "double_opt_in": false,
    "status": "<string>",
    "consent_version": "<string>",
    "lawful_basis": "<string>",
    "email_sha256": "<string>",
    "phone_sha256": "<string>",
    "email_domain": "<string>",
    "method": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| list_id | string | Mandatory | List identifier |
| source | "widget"|"checkout"|"profile"|"import"|"api" | Mandatory | Where opt-in happened |
| double_opt_in | boolean | Mandatory | Whether DOI flow is used |
| status | "pending"|"subscribed" | Optional | Subscription state |
| consent_version | string | Optional | Consent text version |
| lawful_basis | "consent"|"contract"|"legitimate_interest"|"other" | Optional | Legal basis |
| email_sha256 | string | Optional | Hashed email |
| phone_sha256 | string | Optional | Hashed phone |
| email_domain | string | Optional | Derived domain |
| method | "email"|"sms"|"push" | Optional | Channel of subscription |



### `newsletter_unsubscribed`

Contact unsubscribed from a mailing list.


```json
{
  "event": "newsletter_unsubscribed",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "list_id": "<string>",
    "reason": "<string>",
    "provider_message_id": "<string>",
    "comment": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| list_id | string | Mandatory | List identifier |
| reason | "user_click"|"spam_report"|"hard_bounce"|"manual"|"gdpr_request"|"unknown" | Mandatory | Why they left |
| provider_message_id | string | Optional | ESP event id |
| comment | string | Optional | Optional free text |



### `feedback_submitted`

User submitted feedback.


```json
{
  "event": "feedback_submitted",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "channel": "<string>",
    "type": "<string>",
    "rating": 0,
    "comment": "<string>",
    "category": "<string>",
    "attachments_count": 0,
    "sentiment_auto": "<string>",
    "needs_follow_up": false
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| channel | "in_app"|"email"|"web"|"mobile" | Mandatory | Feedback channel |
| type | "bug"|"idea"|"praise"|"question"|"other" | Mandatory | Feedback type |
| rating | integer 1–5 | Optional | Rating if provided |
| comment | string | Optional | Textual feedback |
| category | string | Optional | Area (billing, UX, etc.) |
| attachments_count | integer ≥ 0 | Optional | Attachment count |
| sentiment_auto | "pos"|"neu"|"neg" | Optional | Auto sentiment tag |
| needs_follow_up | boolean | Optional | Flag for CS follow-up |



### `experiment_exposed`

User was exposed to an experiment variant.


```json
{
  "event": "experiment_exposed",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "experiment_id": "<string>",
    "variant_id": "<string>",
    "unit": "<string>",
    "allocation": 0,
    "override_reason": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| experiment_id | string | Mandatory | Experiment id |
| variant_id | string | Mandatory | Variant id |
| unit | "participant"|"anonymous" | Mandatory | Bucketing unit |
| allocation | integer 0–100 | Optional | Allocation percent |
| override_reason | "holdout"|"qa"|"force" | Optional | Reason for override |



### `error_occurred`

An operational error happened in SDK/backend/provider.


```json
{
  "event": "error_occurred",
  "event_id": "<uuid-v4>",
  "occurred_at": "<iso-8601>",
  "client_id": "<client_id>",
  "campaign_id": "<campaign_id>",
  "participant": {
    "external_user_id_hash": "<sha256>",
    "anonymous_id": "<anonymous_id>",
    "session_id": "<session_id>"
  },
  "referral": {
    "referral_id": "<referral_id>",
    "invite_id": "<invite_id>",
    "visit_id": "<visit_id>"
  },
  "properties": {
    "scope": "<string>",
    "code": "<string>",
    "message": "<string>",
    "retryable": false,
    "context": {},
    "provider": "<string>"
  }
}
```

| Property | Type | Required | Used for / Description |
|---|---|---|---|
| scope | "sdk"|"backend"|"provider" | Mandatory | Where it occurred |
| code | string | Mandatory | Error code |
| message | string | Mandatory | Human-readable message |
| retryable | boolean | Optional | Can the client retry |
| context | object | Optional | Structured debug context |
| provider | string | Optional | Provider name if applicable |



---

## 3) Operational Rules
- **Idempotency:** reject duplicates by `(client_id, campaign_id, event_id)`.
- **Security & Privacy:** accept only hashed identifiers for PII; enforce allowlist of domains if using `is_employee`.
- **Size limits:** ≤ 32 KB/event; free-text fields ≤ 4 KB; products array ≤ 100 items.
- **Clock skew:** prefer `occurred_at` for analytics; keep `received_at` for debugging and SLAs.
- **Schema evolution:** only add optional fields/enums for minor versions; bump to v2 for breaking changes.
