@billing @stripe-webhook
Feature: Stripe webhooks
  As the platform
  I want every Stripe event applied exactly once, and only when Stripe really sent it
  So that billing state never drifts from Stripe

  Background:
    Given the application is running

  @needs-active-subscription
  Scenario: A signed event is applied once, and a redelivery is acknowledged without effect
    Given Stripe event "evt_bdd_subscription_deleted" was never received
    When Stripe delivers a signed "customer.subscription.deleted" event "evt_bdd_subscription_deleted" for subscription "sub_bdd_active"
    Then the response status should be 200
    And tenant "default-tenant" billing is on plan "Free" with status "canceled"
    And Stripe event "evt_bdd_subscription_deleted" is recorded as "processed"
    When Stripe delivers the same event again
    Then the response status should be 200
    And Stripe event "evt_bdd_subscription_deleted" was applied exactly once

  Scenario: An event with an invalid signature is rejected and not recorded
    When a Stripe event arrives with an invalid signature
    Then the response status should be 400
    And Stripe event "evt_bdd_forged" is not recorded
