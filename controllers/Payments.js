const { instance } = require("../config/razorpay");
const Course = require("../models/Course");
const CourseProgress = require("../models/CourseProgress");
const User = require("../models/User");
const mailSender = require("../utils/mailSender");
const { courseEnrollmentEmail } = require("../mail/templates/courseEnrollmentEmail");
const { paymentSuccessEmail } = require("../mail/templates/paymentSuccessEmail");

const { default: mongoose } = require("mongoose");
const crypto = require('crypto');

require('dotenv').config();


//capture the payment and initiate the Razorpay order
exports.capturePayment = async (req, res) => {
    //get courseId and UserID
    const { course_id } = req.body;
    const userId = req.user.id;

    //validation
    //valid courseID
    if (!course_id) {
        return res.json({
            success: false,
            message: 'Please provide valid course ID',
        })
    };
    //valid courseDetail
    let course;
    try {
        course = await Course.findById(course_id);
        if (!course) {
            return res.json({
                success: false,
                message: 'Could not find the course',
            });
        }

        //user already pay for the same course
        const uid = new mongoose.Types.ObjectId(userId);
        if (course.studentsEnrolled.includes(uid)) {
            return res.status(200).json({
                success: false,
                message: 'Student is already enrolled',
            });
        }
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }

    //order create
    const amount = course.price;
    const currency = "INR";

    const options = {
        amount: amount * 100,
        currency,
        receipt: Math.random(Date.now()).toString(),
        notes: {
            courseId: course_id,
            userId,
        }
    };

    try {
        //initiate the payment using razorpay
        const paymentResponse = await instance.orders.create(options);
        // console.log(paymentResponse);
        //return response
        return res.status(200).json({
            success: true,
            courseName: course.courseName,
            courseDescription: course.courseDescription,
            thumbnail: course.thumbnail,
            orderId: paymentResponse.id,
            currency: paymentResponse.currency,
            amount: paymentResponse.amount,
        });
    }
    catch (error) {
        console.log(error);
        res.json({
            success: false,
            message: "Could not initiate order",
        });
    }


};

//verify Signature of Razorpay and Server
exports.verifyPayment = async (req, res) => {
    const razorpay_order_id = req.body?.razorpay_order_id;
    const razorpay_payment_id = req.body?.razorpay_payment_id;
    const razorpay_signature = req.body?.razorpay_signature;
    const courses = req.body?.courses;

    const userId = req.user.id;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !courses || !userId) {
        return res.status(400).json({
            success: false,
            message: "Payment Failed: Missing parameters"
        });
    }

    let body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_SECRET)
        .update(body.toString())
        .digest("hex");

    if (expectedSignature === razorpay_signature) {
        try {
            await enrollStudents(courses, userId);
            return res.status(200).json({
                success: true,
                message: "Payment Verified"
            });
        } catch (error) {
            console.log("Enrollment error: ", error.message);
            return res.status(500).json({
                success: false,
                message: "Payment Verified but failed to enroll students"
            });
        }
    }

    return res.status(400).json({
        success: false,
        message: "Payment Failed: Signature mismatch"
    });
};



// exports.verifyPayment = async (req, res) => {
//     const razorpay_order_id = req.body?.razorpay_order_id
//     const razorpay_payment_id = req.body?.razorpay_payment_id
//     const razorpay_signature = req.body?.razorpay_signature
//     const courses = req.body?.courses

//     const userId = req.user.id

//     if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !courses || !userId ) {
//         return res.status(200).json({
//             success: false,
//             message: "Payment Failed"
//         })
//     }

//     let body = razorpay_order_id + "|" + razorpay_payment_id

//     const expectedSignature = crypto
//         .createHmac("sha256", process.env.RAZORPAY_SECRET)
//         .update(body.toString())
//         .digest("hex")

//     if (expectedSignature === razorpay_signature) {
//         await enrollStudents(courses, userId, res)
//         return res.status(200).json({
//             success: true,
//             message: "Payment Verified"
//         })
//     }

//     return res.status(200).json({
//         success: false,
//         message: "Payment Failed"
//     })
// }





// Send Payment Success Email
exports.sendPaymentSuccessEmail = async (req, res) => {
    const { orderId, paymentId, amount } = req.body

    const userId = req.user.id

    if (!orderId || !paymentId || !amount || !userId) {
        return res
            .status(400)
            .json({ success: false, message: "Please provide all the details" })
    }

    try {
        const enrolledStudent = await User.findById(userId)

        await mailSender(
            enrolledStudent.email,
            `Payment Received`,
            paymentSuccessEmail(
                `${enrolledStudent.firstName} ${enrolledStudent.lastName}`,
                amount / 100,
                orderId,
                paymentId
            )
        )
    } catch (error) {
        console.log("error in sending mail", error)
        return res.status(400).json({
            success: false,
            message: "Could not send email"
        })
    }
}

// enroll the student in the courses
const enrollStudents = async (courseId, userId) => {
    console.log("courseID: ", courseId);
    console.log("userID: ", userId);

    if (!courseId || !userId) {
        throw new Error("Please Provide Course ID and User ID");
    }

    try {
        // Find the course and enroll the student in it
        const enrolledCourse = await Course.findByIdAndUpdate({ _id: courseId },
            { $push: { studentsEnroled: userId } },
            { new: true }
        )

        if (!enrolledCourse) {
            throw new Error("Course not found");
        }
        console.log("Updated course: ", enrolledCourse)

        const courseProgress = await CourseProgress.create({
            courseID: courseId,
            userId: userId,
            completedVideos: [],
        })
        // Find the student and add the course to their list of enrolled courses
        const enrolledStudent = await User.findByIdAndUpdate(
            userId,
            {
                $push: {
                    courses: courseId,
                    courseProgress: courseProgress._id,
                },
            },
            { new: true }
        )

        console.log("Enrolled student: ", enrolledStudent)
        // Send an email notification to the enrolled student
        const emailResponse = await mailSender(
            enrolledStudent.email,
            `Successfully Enrolled into ${enrolledCourse.courseName}`,
            courseEnrollmentEmail(
                enrolledCourse.courseName,
                `${enrolledStudent.firstName} ${enrolledStudent.lastName}`
            )
        )

        console.log("Email sent successfully: ", emailResponse.response)
    }
    catch (error) {
        console.log(error)
        throw new Error(error.message);
    }
}
