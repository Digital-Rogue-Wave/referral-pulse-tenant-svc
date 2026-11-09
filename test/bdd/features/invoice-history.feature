@invoice-history
Feature: The Owner views the invoice history (US1.8.3)
  As an Owner
  I want my past invoices with their amounts and PDFs
  So that I can hand them to the accounts department

  Background:
    Given the application is running
    And a company has signed itself up for billing
    And I am that billing company's Owner

  Scenario: A company that has never paid has no invoices, and Stripe is not asked
    When I send a GET request to "/api/v1/billing/invoices" with that token
    Then the response status should be 200
    And the invoice page is empty

  Scenario: Amounts are integers in minor units, as the API contract requires (F1, F2)
    Given that company has a live "Growth" subscription
    And Stripe holds a paid invoice of 4950 cents in euros for that company
    When I send a GET request to "/api/v1/billing/invoices" with that token
    Then the response status should be 200
    And the first invoice is due 4950 and paid 4950 in "eur"
    And the first invoice links its PDF and its hosted page

  Scenario: The list is paged with Stripe's cursors
    Given that company has a live "Growth" subscription
    And Stripe holds 3 invoices for that company
    When I send a GET request to "/api/v1/billing/invoices?limit=2" with that token
    Then the response status should be 200
    And the page holds 2 invoices, has more, and its next cursor is "in_bdd_2"

  Scenario: The next invoice is in minor units too (F1)
    Given that company has a live "Growth" subscription
    And Stripe's next invoice for that company is 990 cents in euros
    When I send a GET request to "/api/v1/billing/invoices/upcoming" with that token
    Then the response status should be 200
    And the upcoming invoice is due 990 in "eur"

  Scenario: A member without billing:read cannot see the invoices
    Given I am a member of that billing company without billing:read
    When I send a GET request to "/api/v1/billing/invoices" with that token
    Then the response status should be 403
