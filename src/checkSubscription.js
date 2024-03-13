import { Subscriptions } from './models.js';
import mongoose from 'mongoose';

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
            subscriptionType: 'basic', // Переход на базовую подписку
            isActive: false, // Установка статуса активности на false
            features: {
                unlimitedLikes: false,
                seeWhoLikesYou: false,
                adFree: false
                },
            startDate: Date.now(),
          }
        });
        console.log(`Subsciption for ${subscription.telegramId} updated`);
      }
    }
  } catch (error) {
    console.error('Ошибка при проверке и обновлении подписок:', error);
  }
}

// Запуск функции проверки статуса подписки через определенный интервал времени (в мс)
setInterval(checkSubscriptionStatus, 60 * 1000);