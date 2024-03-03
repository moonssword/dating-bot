import { YooCheckout } from '@a2seven/yoo-checkout';
import { v4 as uuidv4 } from 'uuid';
import { Subscriptions } from './models.js';

const checkout = new YooCheckout({ shopId: process.env.SHOP_ID, secretKey: process.env.SECRET_KEY });

export async function createPaymentForUser(subscriptionType, userId, chatId, bot) {
  const idempotenceKey = uuidv4();
  const subscriptionPrices = {
    'day': { value: '120.00', duration: '1 день' },
    'week': { value: '200.00', duration: '7 дней' },
    'month': { value: '400.00', duration: '30 дней' },
    '6month': { value: '2000.00', duration: '180 дней' },
    'year': { value: '3500.00', duration: '365 дней' }
  };

  const subscription = subscriptionPrices[subscriptionType];

  const createPayload = {
    amount: {
      value: subscription.value,
      currency: 'RUB'
    },
    capture: true,
    confirmation: {
      type: 'redirect',
      return_url: 'https://t.me/iMatcherBot'
    },
    description: `Premium subscription for ${subscription.duration} for userId: ${userId}`
  };

  try {
    const payment = await checkout.createPayment(createPayload, idempotenceKey);
    // Возвращаем URL для оплаты, чтобы использовать его в кнопках
    return payment.confirmation.confirmation_url;
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, 'Произошла ошибка при создании платежа. Пожалуйста, попробуйте позже.');
    return null;
  }
}

export default { createPaymentForUser };