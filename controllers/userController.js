const ErrorHandler = require("../utils/errorhander");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const User = require("../models/userModel");
const sendToken = require("../utils/jwtToken");
const sendEmail = require("../utils/sendEmail");
const cloudinary = require("cloudinary").v2;

//Register User profile
exports.registerUser = catchAsyncErrors(async (req, res, next) => {
  if (!req.files || !req.files.avatar) {
    return res
      .status(400)
      .json({ success: false, message: "No avatar uploaded" });
  }
  const avatarFile = req.files.avatar;

  try {
    // Upload image data to Cloudinary from Buffer
    const myCloud = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream({ resource_type: "image" }, (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        })
        .end(avatarFile.data);
    });
    const { name, email, password, mobile, bio, is_private } = req.body;
    const newUser = new User({
      name,
      email,
      password,
      mobile,
      bio,
      is_private,
      avatar: {
        public_id: myCloud.public_id,
        url: myCloud.secure_url,
      },
    });
    // Save user to database
    const user = await newUser.save();

    //sending mail
    const message = `<div>
    <h1> Hello ${user.name}, Welcome To Our organization <h1/>

     <h4> Your Email : ${user.email}<h4/>
     <h4>  Your Password : ${password}<h4/>

     <h4>Regards<h4/>
     <h4>Our organization<h4/>

    <div/>`;

    await sendEmail({
      email: user.email,
      subject: `Your Account is Successfully Registered`,
      message,
    });
    // Send response with user data and token
    sendToken(user, 200, res);
  } catch (error) {
    console.error("User Creation Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Login User
exports.loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(
        new ErrorHandler("Please enter both email and password", 400)
      );
    }

    // Find user by email and select password field (which is usually not selected by default)
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return next(new ErrorHandler("Invalid email or password", 401));
    }

    // Check if provided password matches the hashed password stored in the database
    const isPasswordMatched = await user.comparePassword(password);

    if (!isPasswordMatched) {
      return next(new ErrorHandler("Invalid email or password", 401));
    }

    sendToken(user, 200, res);
  } catch (error) {
    console.error("Error logging in user:", error);
    return next(new ErrorHandler("Login failed", 500));
  }
};

// Logout User
exports.logout = async (req, res, next) => {
  try {
    // Clear the token cookie to log the user out
    res.cookie("token", null, {
      expires: new Date(Date.now()),
      httpOnly: true,
    });

    res.status(200).json({
      success: true,
      message: "Logged Out",
    });
  } catch (error) {
    console.error("Error logging out:", error);
    return next(new ErrorHandler("Failed to log out", 500));
  }
};

// Get User Detail By ID
exports.getUserDetails = async (req, res, next) => {
  try {
    const id = req.params.id;
    // Find the user by ID in the database
    const user = await User.findById(id);
    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }
    res.status(200).json({
      success: true,
      message: "User profile Details",
      data: user,
    });
  } catch (error) {
    console.error("Error fetching user details:", error);
    return next(new ErrorHandler("Failed to fetch user details", 500));
  }
};

// update User password
exports.updatePassword = catchAsyncErrors(async (req, res, next) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;

    const user = await User.findById(req.user.id).select("+password");
    const isPasswordMatched = await user.comparePassword(oldPassword);

    if (!isPasswordMatched) {
      return next(new ErrorHandler("Old password is incorrect", 400));
    }

    // Check if the new password matches the confirm password
    if (newPassword !== confirmPassword) {
      return next(new ErrorHandler("Passwords do not match", 400));
    }

    // Update the user's password with the new password
    user.password = newPassword;

    await user.save();

    sendToken(user, 200, res);
  } catch (error) {
    console.error("Error updating password:", error);
    return next(new ErrorHandler("Failed to update password", 500));
  }
});

// update User Profile
exports.updateProfile = async (req, res, next) => {
  const userId = req.params.id; // Get user ID from request params
  const { name, email, mobile, bio, is_private, avatar } = req.body; // Extract updated profile data

  // Check if the user exists
  const existingUser = await User.findById(userId);
  if (!existingUser) {
    return next(new ErrorHandler("User not found", 404));
  }

  // Prepare updated user data object
  let updatedUserData = {
    name,
    email,
    mobile,
    bio,
    is_private,
  };
  const avatarFile = req.files.avatar;
  // Handle avatar update if a new avatar URL is provided
  if (avatarFile) {
    try {
      // Upload new avatar to Cloudinary
      const uploadedAvatar = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream({ resource_type: "image" }, (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result);
            }
          })
          .end(avatarFile.data);
      });

      // Delete existing avatar from Cloudinary (if exists)
      if (existingUser.avatar && existingUser.avatar.public_id) {
        await cloudinary.uploader.destroy(existingUser.avatar.public_id);
      }

      // Update avatar data in updatedUserData
      updatedUserData.avatar = {
        public_id: uploadedAvatar.public_id,
        url: uploadedAvatar.secure_url,
      };
    } catch (error) {
      console.error("Error uploading avatar to Cloudinary:", error);
      return res.status(500).json({
        success: false,
        message: "Error uploading avatar to Cloudinary",
      });
    }
  }

  // Update user profile in the database
  try {
    const updatedUser = await User.findByIdAndUpdate(userId, updatedUserData, {
      new: true, // Return the updated user object
      runValidators: true,
      useFindAndModify: false,
    });

    res.status(200).json({
      success: true,
      message: "User profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Error updating user profile:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error updating user profile" });
  }
};

// Get all public users
exports.getAllPublicUsers = async (req, res, next) => {
  try {
    // Find all users where is_private is false (public users)
    const users = await User.find({ is_private: false });

    res.status(200).json({
      success: true,
      message: "Public Users",
      data: users,
    });
  } catch (error) {
    console.error("Error fetching public users:", error);
    return next(new ErrorHandler("Failed to fetch public users", 500));
  }
};

// Get all users(admin)
exports.getAllUser = async (req, res, next) => {
  try {
    const users = await User.find();

    res.status(200).json({
      success: true,
      message: "All Users Details",
      data: users,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    return next(new ErrorHandler("Failed to fetch users", 500));
  }
};
