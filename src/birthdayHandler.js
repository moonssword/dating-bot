// birthdayHandler.js

export
async function handleBirthday(bot, currentUserState, User, Profile, i18n, msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const birthdayRegex = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/;
  const existingUser = await User.findOne({ telegramId: userId });
  const userProfile = await Profile.findOne({ telegramId: userId });
  const currentState = currentUserState.get(userId);

  if (currentState === 'enter_birthday' && msg.text) {
      const birthdayText = msg.text.trim();
      const isValidFormat = birthdayRegex.test(birthdayText);
  
      if (isValidFormat) {
          const [fullMatch, day, month, year] = birthdayRegex.exec(birthdayText);
          const birthdayDate = new Date(`${year}-${month}-${day}`);
          const currentDate = new Date();
          let age = currentDate.getFullYear() - birthdayDate.getFullYear();
            if (currentDate.getMonth() < birthdayDate.getMonth() || (currentDate.getMonth() === birthdayDate.getMonth() && currentDate.getDate() < birthdayDate.getDate())) {
                age--;
            }

  
          if (age >= 18 && age <= 110) {
              try {
                  const updatedProfile = await Profile.findOneAndUpdate(
                      { telegramId: userId },
                      { birthday: birthdayDate, age: age,
                        'preferences.ageRange.min': userProfile.gender === 'male' ? Math.max(age - 10, 18) : age,
                        'preferences.ageRange.max': userProfile.gender === 'male' ? age : age + 10, },
                      { new: true }
                  );
  
                  console.log('User birthday updated:', updatedProfile);
  
                  const savedMessage = await bot.sendMessage(chatId, i18n.__('birthday_saved'));
                  if (existingUser.globalUserState === 'registration_process') {
                    setTimeout(async () => {
                      try {
                          await bot.deleteMessage(chatId, savedMessage.message_id);
                          await bot.sendMessage(chatId, i18n.__('request_photo_message_text'));
                      } catch (error) {
                          console.error('Error:', error);
                      }
                    }, 2000);
                    currentUserState.set(userId, 'select_photo');
                  } else if (existingUser.globalUserState === 'active') {
                    setTimeout(async () => {
                      try {
                        let aboutMeText = updatedProfile.aboutMe ? `<blockquote><i>${updatedProfile.aboutMe}</i></blockquote>` : '';  
                        const genderText = updatedProfile.gender === 'male' ? i18n.__('select_male') : i18n.__('select_female');
                          await bot.deleteMessage(chatId, savedMessage.message_id);
                          await bot.sendPhoto(chatId, updatedProfile.profilePhoto.photoPath, {
                            caption: `${updatedProfile.profileName}, ${updatedProfile.age}\n 🌍${updatedProfile.location.locality}, ${updatedProfile.location.country}\n${genderText}\n${aboutMeText}`,
                            reply_markup: {
                              keyboard: i18n.__('myprofile_buttons'),
                              resize_keyboard: true
                            },
                            parse_mode: 'HTML',
                            protect_content: true,
                          });
                      } catch (error) {
                          console.error('Error:', error);
                      }
                    }, 2000);
                    currentUserState.set(userId, 'my_profile');
                  }
              } catch (err) {
                  console.error('Error updating user birthday:', err);
                  bot.sendMessage(chatId, i18n.__('birthday_not_saved')); //Отладка
              }
          } else {
            const errorMessage = await bot.sendMessage(chatId, i18n.__('invalid_birthday_format'));
            setTimeout(async () => {
                try {
                    await bot.deleteMessage(chatId, errorMessage.message_id);
                } catch (error) {
                    console.error('Error:', error);
                }
            }, 3000);
          }
      } else {
        const errorMessage = await bot.sendMessage(chatId, i18n.__('invalid_birthday_format'));
        setTimeout(async () => {
            try {
                await bot.deleteMessage(chatId, errorMessage.message_id);
            } catch (error) {
                console.error('Error:', error);
            }
        }, 3000);
      }
  }
};

export default { handleBirthday };