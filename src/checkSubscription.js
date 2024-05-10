import { Subscriptions } from './models.js';
import mongoose from 'mongoose';
// import { botForSendPaymentNotification } from '../src/index.js';

mongoose.connect('mongodb://localhost:27017/userdata')
.then(() => console.log('Connected to MongoDB for checkSubscription'))
.catch((error) => console.error('Connection to MongoDB checkSubscription failed:', error));

// Функция для регулярной проверки и обновления подписки
async function checkSubscriptionStatus() {
  try {
    const activeSubscriptions = await Subscriptions.find({ isActive: true, subscriptionType: { $ne: 'basic' } });
    for (const subscription of activeSubscriptions) {
      if (subscription.endDate < Date.now()) { // Если подписка истекла
        await Subscriptions.findByIdAndUpdate(subscription._id, {
          $set: {
            subscriptionType: 'basic',
            isActive: false,
            features: {
                unlimitedLikes: false,
                seeWhoLikesYou: false,
                adFree: false
                },
            startDate: Date.now(),
            endDate: Date.now()
          }
        });
        console.log(`Subsciption for ${subscription.telegramId} checked`);
      }
    }
  } catch (error) {
    console.error('Ошибка при проверке и обновлении подписок:', error);
  }
}

// Запуск функции проверки статуса подписки через определенный интервал времени (в мс) (24 ч)
setInterval(checkSubscriptionStatus, 24 * 60 * 60 * 1000);

//Функция обновления подписки после оповещения об оплате
export async function updateSubscription(orderId, newData) {
  try {
    let days;
    switch (newData.amount) {
      case "200.00":
        days = 7;
        break;
      case "400.00":
        days = 30;
        break;
      case "1600.00":
        days = 180;
        break;
      case "2800.00":
        days = 365;
        break;
      default:
        days = 0;
        break;
    }    

    const currentDate = new Date();
    const subscription = await Subscriptions.findOne({ 'orders.orderId': orderId });
    const newEndDate = subscription.endDate > currentDate ? new Date(subscription.endDate.setDate(subscription.endDate.getDate() + days)) : new Date(currentDate.setDate(currentDate.getDate() + days));    
    
    const updatedSubscription = await Subscriptions.findOneAndUpdate(
      { 'orders.orderId': orderId },
      {
        $set: {
          'orders.$.invoiceId': newData.invoiceId,
          'orders.$.paymentStatus': newData.paymentStatus,
          'orders.$.amount': newData.amount,
          'orders.$.currency': newData.currency,
          'orders.$.method': newData.method,
          'orders.$.email': newData.email,
          'orders.$.updatedAt': Date.now(),
          subscriptionType: 'premium',
          isActive: true,
          features: {
              unlimitedLikes: true,
              seeWhoLikesYou: true,
              adFree: true
              },
          startDate: Date.now(),
          endDate: newEndDate //Добавить логику продления существующей подписки
        }
      },
      { new: true }
    );
    
    // //Вызов функции отправки сообщения пользователю и админу об успешной оплате
    // const userId = updatedSubscription.telegramId;
    // await botForSendPaymentNotification(userId, days);

    if (!updatedSubscription) {
      console.log(`Subscription ${orderId} not found`);
      return null;
    }
    console.log(`Subsciption for ${updatedSubscription.telegramId} has been successfully paid before ${updatedSubscription.endDate.toLocaleDateString()}.`);
    return updatedSubscription;
    
  } catch (error) {
    console.error('Error updating subscription:', error);
    return null;
  }
}

export default { updateSubscription };