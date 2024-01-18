export function sendMyProfile(bot, chatId, userProfile, i18n) {
    bot.sendPhoto(chatId, userProfile.profilePhoto.photoPath, {
      caption: `${userProfile.profileName}, ${userProfile.age}\n 🌍${userProfile.location.locality}, ${userProfile.location.country}\n${i18n.__('myprofile_gender_message')} ${userProfile.gender}\n ➖➖➖➖➖➖➖➖➖➖\n
      ${userProfile.aboutMe}`,
      reply_markup: {
        keyboard: i18n.__('myprofile_buttons'),
        resize_keyboard: true
      }});
  }
  
export function sendMyUpdatedProfile(bot, chatId, updatedProfile) {
    bot.sendPhoto(chatId, updatedProfile.profilePhoto.photoPath, {
      caption: `${updatedProfile.profileName}, ${updatedProfile.age}\n 🌍${updatedProfile.location.locality}, ${updatedProfile.location.country}\n${i18n.__('myprofile_gender_message')} ${updatedProfile.gender}\➖➖➖➖➖➖➖➖➖➖\n${updatedProfile.aboutMe}`,
      reply_markup: {
        keyboard: i18n.__('myprofile_buttons'),
        resize_keyboard: true
      }});
  }

export default { 
    sendMyProfile, 
    sendMyUpdatedProfile,
};