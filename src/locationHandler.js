// locationModule.js
import axios from 'axios';
import i18n from 'i18n';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

i18n.configure({
  locales: ['en', 'ru'], // Доступные языки
  directory: `${__dirname}/locales`, // Путь к файлам перевода
  defaultLocale: 'ru', // Язык по умолчанию
  objectNotation: true, // Использование объектной нотации для строк
});

function generateUniqueID() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

export async function getFromLocation(chatId, locationMessage, bot) {
  try {
    const { latitude, longitude } = locationMessage;
    const locationData = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10`);
    
    const locality = locationData.data.address.city || locationData.data.address.town || locationData.data.address.village || locationData.data.address.hamlet || locationData.data.name;
    const display_name = locationData.data.display_name;
    const state = locationData.data.address.state;
    const country = locationData.data.address.country;
    const addresstype = locationData.data.addresstype;

    return { locality, display_name, addresstype, state, country };
      } catch (err) {
        console.error('Ошибка:', err);
      return err;
      }
    }

export async function getFromCityName(cityName, bot, chatId, locationDataMap) {
  try {
    const encodedCity = encodeURIComponent(cityName);
    const cityData = await axios.get(`https://nominatim.openstreetmap.org/search?format=json&q=${encodedCity}&limit=20`);

    const validCities = cityData.data.filter(locality =>
      ['city', 'town', 'village', 'hamlet'].includes(locality.addresstype)
    );

    if (validCities.length === 0) {
      const errorMessage = await bot.sendMessage(chatId, i18n.__('city_not_found'));
      setTimeout(async () => {
          try {
              await bot.deleteMessage(chatId, errorMessage.message_id);
          } catch (error) {
              console.error('Error:', error);
          }
      }, 3000);
    } else {
      const cities = validCities.map(locality => {
        return {
          display_name: locality.display_name || '',
          locality: locality.name || '',
          addresstype: locality.addresstype || '',
          state: locality.state || '',
          country: locality.country || '',
          latitude: locality.lat,
          longitude: locality.lon,
        };
      });

      const locationId = generateUniqueID();
      locationDataMap.set(locationId, cities);

      const keyboard = {
        inline_keyboard: cities.map((locality, index) => [
          {
            text: `🔹 ${locality.display_name}`,
            callback_data: JSON.stringify({
              locationId: locationId,
              cityIndex: index,
            }),
          },
        ]),
      };

      bot.sendMessage(chatId, i18n.__('list_of_cities'), {
        reply_markup: keyboard,
      });
    }
  } catch (err) {
    console.error('Ошибка:', err);
    bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
  }
}

export default {
  getFromLocation,
  getFromCityName,
};