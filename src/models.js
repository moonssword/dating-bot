import mongoose from 'mongoose';

// Схема пользователя
const userSchema = new mongoose.Schema({
    telegramId: { type: Number, int64: true },
    userName: String,
    firstName: String,
    lastName: String,
    languageCode: String,
    globalUserState: {
        type: String,
        enum: ['active', 'registration_process', 'new', 'blocked', 'banned', 'deleted', 'rejected'],
        default: 'new',
      },
    blockReason: {
        type: String,
        enum: ['spam', 'offensive_behavior', 'inappropriate_content', 'fraud', 'impersonation', 'community_rules_violation', 'inactivity', 'deleted_himself', 'face_not_detected', 'multiple_complaints', ''],
        default: '',
      },
    isBlocked: { type: Boolean, default: false },
    blockDetails: {
        blockedAt: Date,
        unblockedAt: Date,
        notes: String,
      },
    reports: [{
        type: {
            type: String,
            enum: ['fake_profile', 'sale_goods', 'inappropriate_content', 'minor_user', 'threats'],
            required: true,
        },
        reportedBy: { type: Number, int64: true },
        date: { type: Date, default: Date.now },
    }],
    isBot: Boolean,
    feedback: { text: String, date: Date },
  }, { versionKey: false, timestamps: true  });
  // Модель пользователя
  userSchema.index({ telegramId: 1 }, { unique: true });
  export const User = mongoose.model('User', userSchema, 'users');
  
  // Схема профиля
  const profileSchema = new mongoose.Schema({
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    telegramId: { type: Number, int64: true },
    userName: String,
    profileName: String,
    gender: String,
    birthday: Number,
    age: Number,
    interests: String,
    isActive: {
        type: Boolean,
        default: true,
    },
    aboutMe: {
        type: String,
        maxlength: 1000
    },
    lastActivity: Number,
    preferences: {
      preferredGender: String,
      ageRange: {
        min: Number,
        max: Number,
      },
      preferredLocation: {
        locality: String,
        country: String,
      },
    },
    profilePhoto: {
      photo_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'UserPhoto',
      },
      photoPath: String,
      photoBlurredPath: String,
      uploadDate: Date,
    },
    location: {
      locality: String,
      display_name: String,
      addresstype: String,
      state: String,
      country: String,
      sentGeolocation: Boolean,
      latitude: Number, //location: { type: "Point", coordinates: [longitude, latitude] }, В дальнейшем для указания расстояния до кандидата
      longitude: Number,
    },
    likedProfiles: [{
      type: Number,
      ref: 'Profile',
      int64: true,
    }],
    dislikedProfiles: [{
      type: Number,
      ref: 'Profile',
      int64: true,
    }],
    matches: [{
      type: Number,
      ref: 'Profile',
      int64: true,
    }],
    viewingMatchIndex: Number,
    viewingLikesYouIndex: Number,
  }, { versionKey: false, timestamps: true  });
  // Модель профиля
  profileSchema.index({ telegramId: 1 }, { unique: true });
  export const Profile = mongoose.model('Profile', profileSchema, 'profiles');
  
  //Схема фотографий профиля
  const userPhotoSchema = new mongoose.Schema({
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    telegramId: { type: Number, int64: true },
    rejectCount: Number,
    photos: [{
      filename: String,
      path: String,
      blurredPath: String,
      size: Number,
      uploadDate: { type: Date, default: Date.now },
      verifiedPhoto: { type: Boolean, default: false },
    }]
  }, { versionKey: false, timestamps: true  });
  userPhotoSchema.index({ telegramId: 1 }, { unique: true });
  //Модель фотографий профиля
  export const UserPhoto = mongoose.model('UserPhoto', userPhotoSchema, 'usersPhotos');
  
    //Схема подписки
  const subscriptionsSchema = new mongoose.Schema({
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    telegramId: { type: Number, int64: true },
    subscriptionType: {
      type: String,
      enum: ['basic', 'plus', 'premium', 'promo'],
      default: 'basic',
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    orders: [
      {
        orderId: { type: String },
        invoiceId: { type: String },
        paymentStatus: {
            type: String,
            enum: ['in_process', 'success', 'expired', 'hold', 'not_required'],
            default: 'not_required',
        },
        amount: { type: Number },
        currency: { type: String },
        method: { type: String },
        email: { type: String },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
      }
    ],
    features: {
      unlimitedLikes: {
        type: Boolean,
        default: false,
      },
      seeWhoLikesYou: {
        type: Boolean,
        default: false,
      },
      additionalSearchFilters: {
        type: Boolean,
        default: false,
      },
      adFree: {
        type: Boolean,
        default: false,
      },
    },
  }, { versionKey: false, timestamps: true });
  subscriptionsSchema.index({ telegramId: 1 }, { unique: true });
  export const Subscriptions = mongoose.model('Subscriptions', subscriptionsSchema, 'subscriptions');

  export default {
    User,
    Profile,
    UserPhoto,
    Subscriptions
  };