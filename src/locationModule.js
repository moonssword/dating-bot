// locationModule.js
const axios = require('axios');

function generateUniqueID() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

async function getFromLocation(chatId, locationMessage, bot) {
  try {
    const { latitude, longitude } = locationMessage;
    const locationData = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10`);
    
    const locality = locationData.data.address.city || locationData.data.address.town || locationData.data.address.village || locationData.data.address.hamlet;
    const state = locationData.data.address.state;
    const country = locationData.data.address.country;
    const type = locationData.data.type;

return { locality, type, state, country };
  } catch (err) {
    console.error('Ошибка:', err);
  return err;
  }
}

async function getFromCityName(cityName, bot, chatId, locationDataMap) {
  try {
    const encodedCity = encodeURIComponent(cityName);
    const cityData = await axios.get(`https://nominatim.openstreetmap.org/search?format=json&q=${encodedCity}&limit=20`);

    if (cityData.data.length === 0) {
      bot.sendMessage(chatId, 'Город не найден');
    } else {
      const cities = cityData.data
        .filter((locality) => ['city', 'town', 'village', 'hamlet'].includes(locality.type))
        .map((locality) => {
          return {
            display_name: locality.display_name || '',
            locality: locality.name || '',
            type: locality.type || '',
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
            text: locality.display_name,
            callback_data: JSON.stringify({
              locationId: locationId,
              cityIndex: index,
            }),
          },
        ]),
      };

      bot.sendMessage(chatId, 'Найдены города с таким названием:', {
        reply_markup: keyboard,
      });
    }
  } catch (err) {
    console.error('Ошибка:', err);
    bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
  }
}

module.exports = {
  getFromLocation,
  getFromCityName,
};