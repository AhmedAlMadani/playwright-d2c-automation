import { User, SubscriptionState } from '../types/api';
import { faker } from '@faker-js/faker';

export class DataFactory {
  static generateUserData(password?: string): User {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    return {
      id: faker.string.uuid(),
      email: faker.internet.email({ firstName, lastName }),
      password: password || faker.internet.password(),
      createdAt: new Date().toISOString(),
    };
  }

  static generatePlanId(): string {
    const plans = ['basic', 'premium', 'enterprise'];
    return faker.helpers.arrayElement(plans);
  }

  static generateCardDetails() {
    return {
      cardNumber: faker.finance.creditCardNumber(),
      expiry: faker.date.future().toLocaleDateString('en-US', { month: '2-digit', year: '2-digit' }).replace('/', ''),
      cvv: faker.finance.creditCardCVV(),
    };
  }

  static generateSubscriptionState(): SubscriptionState {
    const states: SubscriptionState[] = ['active', 'inactive', 'trial', 'past_due', 'canceled'];
    return faker.helpers.arrayElement(states);
  }
}
