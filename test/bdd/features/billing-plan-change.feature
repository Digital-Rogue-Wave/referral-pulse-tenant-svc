@billing-plan-change
Feature: The Owner changes the plan through a Stripe subscription (US1.8.2)
  As an Owner
  I want to move between plans on Stripe-hosted pages only
  So that I pay for exactly one plan, and my access follows what I paid

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

  Scenario: A company that already pays cannot open a second subscription (F2)
    Given that company has a live "Growth" subscription
    When I send a POST request to "/api/v1/billing/subscription/checkout" with body:
      """
      { "plan": "Scale" }
      """
    Then the response status should be 409
    And the error code is "state_conflict"

  Scenario: Free needs no checkout, and Enterprise is sold by sales (F2, F6)
    When I send a POST request to "/api/v1/billing/subscription/checkout" with body:
      """
      { "plan": "Free" }
      """
    Then the response status should be 400
    When I send a POST request to "/api/v1/billing/subscription/checkout" with body:
      """
      { "plan": "Enterprise" }
      """
    Then the response status should be 400

  Scenario: An upgrade can only go up, so it never skips the downgrade's checks (F3)
    Given that company has a live "Growth" subscription
    When I send a POST request to "/api/v1/billing/subscription/upgrade" with body:
      """
      { "targetPlan": "Starter" }
      """
    Then the response status should be 400
    And Stripe was asked for no upgrade

  Scenario: The plan changes when Stripe confirms the upgrade, not before (F10)
    Given that company has a live "Growth" subscription
    When I send a POST request to "/api/v1/billing/subscription/upgrade" with body:
      """
      { "targetPlan": "Scale" }
      """
    Then the response status should be 202
    And the response should contain a "plan" field with value "Growth"
    And Stripe was asked to move the subscription to "Scale"
    When Stripe reports that company's subscription moved to "Scale"
    Then that company's billing is on plan "Scale" with status "active"

  Scenario: A declined card is a 402 with Stripe's message, not a 500 (F5)
    Given that company has a live "Growth" subscription
    And Stripe will decline the card on the next upgrade
    When I send a POST request to "/api/v1/billing/subscription/upgrade" with body:
      """
      { "targetPlan": "Scale" }
      """
    Then the response status should be 402
    And the error code is "card_declined"
    And that company's billing is on plan "Growth" with status "active"

  Scenario: Paying a late invoice in Stripe's current shape restores the company (F1)
    Given that company has a live "Growth" subscription
    And that company's payments are "past_due"
    When Stripe delivers that company's paid invoice in its current shape
    Then that company's payments are back to "active"

  Scenario: When the subscription ends, the company is Free and owes nothing, and the trail says so (F4, F9)
    Given that company has a live "Growth" subscription
    And that company's payments are "past_due"
    When Stripe reports that company's subscription ended
    Then that company's billing is on plan "Free" with status "canceled"
    And that company's payments are back to "active"
    And the end of the subscription is audit-logged with the system as actor

  Scenario: Cards are entered on Stripe's pages only: the embedded-form routes are gone (F7)
    When I send a POST request to "/api/v1/billing/payment-methods" with that token
    Then the response status should be 404
    When I send a GET request to "/api/v1/billing/payment-methods" with that token
    Then the response status should be 404
