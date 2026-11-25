@billing-plan-change
Feature: The Owner changes the plan through a Stripe subscription (US1.8.2)
  As an Owner
  I want to start my subscription at checkout and change it on Stripe-hosted pages only
  So that I pay for exactly one plan, and my access follows what I paid

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

@extension
  Scenario: A company that already pays cannot open a second subscription (F2)
    Given that company has a live "Growth" subscription
    When I send a POST request to "/api/v1/billing/subscription/checkout" with body:
      """
      { "plan": "Scale" }
      """
    Then the response status should be 409
    And the error code is "state_conflict"

@extension
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

@us-1.8.2
@ac-us-1.8.2-2
@evidence-partial
  Scenario: A plan changed in Stripe's portal reaches the company when Stripe confirms it (F10)
    Given that company has a live "Growth" subscription
    When Stripe reports that company's subscription moved to "Scale"
    Then that company's billing is on plan "Scale" with status "active"

@extension
  Scenario: Plan changes happen in Stripe's portal only: the plan-change routes are gone (v5.2 API)
    When I send a POST request to "/api/v1/billing/subscription/upgrade/preview" with body:
      """
      { "targetPlan": "Scale" }
      """
    Then the response status should be 404
    When I send a POST request to "/api/v1/billing/subscription/upgrade" with body:
      """
      { "targetPlan": "Scale" }
      """
    Then the response status should be 404
    When I send a POST request to "/api/v1/billing/subscription/downgrade" with body:
      """
      { "targetPlan": "Starter" }
      """
    Then the response status should be 404
    When I send a POST request to "/api/v1/billing/subscription/downgrade/cancel" with that token
    Then the response status should be 404
    When I send a POST request to "/api/v1/billing/subscription/cancel" with that token
    Then the response status should be 404
    When I send a POST request to "/api/v1/billing/subscription/reactivate" with that token
    Then the response status should be 404

@extension
  Scenario: Paying a late invoice in Stripe's current shape restores the company (F1)
    Given that company has a live "Growth" subscription
    And that company's payments are "past_due"
    When Stripe delivers that company's paid invoice in its current shape
    Then that company's payments are back to "active"

@us-1.8.2
@ac-us-1.8.2-2
@evidence-partial
  Scenario: When the subscription ends, the company is Free and owes nothing, and the trail says so (F4, F9)
    Given that company has a live "Growth" subscription
    And that company's payments are "past_due"
    When Stripe reports that company's subscription ended
    Then that company's billing is on plan "Free" with status "canceled"
    And that company's payments are back to "active"
    And the end of the subscription is audit-logged with the system as actor

@extension
  Scenario: Cards are entered on Stripe's pages only: the embedded-form routes are gone (F7)
    When I send a POST request to "/api/v1/billing/payment-methods" with that token
    Then the response status should be 404
    When I send a GET request to "/api/v1/billing/payment-methods" with that token
    Then the response status should be 404
