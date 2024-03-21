//AAIO
import { v4 as uuidv4 } from 'uuid';
import { Client } from 'aaio.js';
import axios from 'axios';
import 'dotenv/config';
import { Subscriptions } from './models.js';

const url = 'https://aaio.so/api/info-pay';
const apiKey = process.env.AAIO_API_KEY;
const secretKey1 = process.env.AAIO_SECRET_KEY_1;
const merchantId = process.env.AAIO_MERCHANT_ID;

const client = new Client(apiKey);
const merchant = client.createMerchant(merchantId, secretKey1);

export async function createPaymentForUser(subscriptionType, userId, chatId, bot, i18n) {

    const subscriptionPrices = {
      'week': { value: 200.00, duration: '7' },
      'month': { value: 400.00, duration: '30' },
      '6month': { value: 1600.00, duration: '180' },
      'year': { value: 2800.00, duration: '365' }
    };

    const subscription = subscriptionPrices[subscriptionType];

    const amount = parseFloat(subscription.value);
    const order_id = uuidv4();
    const currency = 'RUB';
    const options = {
      lang: 'ru',
      //method: 'cards_ru',
      desc: i18n.__('messages.payment_description', { duration: subscription.duration })
    }

    try {
      const paymentURL = await merchant.createPayment(amount, order_id, currency, options);
      
      const updateSubscriptions = await Subscriptions.findOneAndUpdate(
        { telegramId: userId },
        {
          $push: {
            orders: {
              orderId: order_id,
              paymentStatus: 'in_process',
              amount: amount
            }
          }
        },
        { new: true }
      );
      console.log('User subscription updated:', updateSubscriptions);      
      
      return paymentURL;

    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, 'Произошла ошибка при создании платежа. Пожалуйста, попробуйте позже.');
      return null;
    }
}

export async function getPaymentInfo(orderId) {
        try {
          const response = await axios.get(url, {
              params: {
                  merchant_id: merchantId,
                  order_id: orderId
              },
              headers: {
                  'Accept': 'application/json',
                  'X-Api-Key': apiKey
              }
          });
          return response.data;
      } catch (error) {
          console.error('Произошла ошибка:', error.message);
      }
}

export default { createPaymentForUser, getPaymentInfo };




//===========================================================================================================================
//YOOMONEY
/*
import { YooCheckout } from '@a2seven/yoo-checkout';
import { v4 as uuidv4 } from 'uuid';

const checkout = new YooCheckout({ shopId: process.env.YK_SHOP_ID, secretKey: process.env.YK_SECRET_KEY });

export async function createPaymentForUser(subscriptionType, userId, chatId, bot) {
  const idempotenceKey = uuidv4();
  const subscriptionPrices = {
    //'day': { value: '120.00', duration: '1 день' },
    'week': { value: '200.00', duration: '7 дней' },
    'month': { value: '400.00', duration: '30 дней' },
    '6month': { value: '1600.00', duration: '180 дней' },
    'year': { value: '2800.00', duration: '365 дней' }
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
*/