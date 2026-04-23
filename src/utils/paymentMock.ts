/**
 * PaymentMock — Deterministic payment simulation helpers.
 *
 * Tests should NEVER rely on random payment outcomes. This utility provides
 * fixed card numbers and mock API response builders that guarantee predictable
 * success or failure scenarios every run.
 */

export interface CardDetails {
  cardNumber: string;
  expiry: string;
  cvv: string;
}

export type PaymentScenario = 'success' | 'failure' | 'expired_card' | 'insufficient_funds';

/**
 * Well-known test card numbers (not connected to any real payment gateway).
 */
const MOCK_CARDS: Record<PaymentScenario, CardDetails> = {
  success: {
    cardNumber: '4242 4242 4242 4242',
    expiry: '12/30',
    cvv: '123',
  },
  failure: {
    cardNumber: '4000 0000 0000 0002',
    expiry: '12/30',
    cvv: '123',
  },
  expired_card: {
    cardNumber: '4000 0000 0000 0069',
    expiry: '01/20', // expired
    cvv: '123',
  },
  insufficient_funds: {
    cardNumber: '4000 0000 0000 9995',
    expiry: '12/30',
    cvv: '123',
  },
};

/**
 * Error messages returned by the mock payment API per scenario.
 */
const MOCK_ERROR_MESSAGES: Partial<Record<PaymentScenario, string>> = {
  failure: 'Your card was declined.',
  expired_card: 'Your card has expired.',
  insufficient_funds: 'Your card has insufficient funds.',
};

export class PaymentMock {
  /**
   * Returns card details for the given payment scenario.
   */
  static getCard(scenario: PaymentScenario): CardDetails {
    return { ...MOCK_CARDS[scenario] };
  }

  /**
   * Convenience accessor for the success card.
   */
  static getSuccessCard(): CardDetails {
    return PaymentMock.getCard('success');
  }

  /**
   * Convenience accessor for the generic failure card.
   */
  static getFailureCard(): CardDetails {
    return PaymentMock.getCard('failure');
  }

  /**
   * Returns the expected error message for a given failure scenario.
   * Returns undefined for the 'success' scenario.
   */
  static getExpectedError(scenario: PaymentScenario): string | undefined {
    return MOCK_ERROR_MESSAGES[scenario];
  }

  /**
   * Returns true if the scenario represents a successful payment.
   */
  static isSuccessScenario(scenario: PaymentScenario): boolean {
    return scenario === 'success';
  }

  /**
   * Returns all failure scenarios for parameterised test iteration.
   */
  static getFailureScenarios(): PaymentScenario[] {
    return ['failure', 'expired_card', 'insufficient_funds'];
  }
}
