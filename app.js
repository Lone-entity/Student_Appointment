// Import necessary modules
const dotenv = require('dotenv');
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const app = express();

dotenv.config();
app.use(bodyParser.json());
const SECRET_KEY = process.env.SECRET_KEY

// Database connection
mongoose.connect(process.env.MOONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

console.log("Starting the application...");

// Schemas and Models
const userSchema = new mongoose.Schema({
    username: String,
    password: String,
    role: String, 
});

const availabilitySchema = new mongoose.Schema({
    professorId: mongoose.Schema.Types.ObjectId,
    slots: [String],
});

const appointmentSchema = new mongoose.Schema({
    professorId: mongoose.Schema.Types.ObjectId,
    studentId: mongoose.Schema.Types.ObjectId,
    time: String,
});



const User = mongoose.model('User', userSchema);
const Availability = mongoose.model('Availability', availabilitySchema);
const Appointment = mongoose.model('Appointment', appointmentSchema);
(async () => {

    try {
        
        console.log('Clearing database...');
        await User.deleteMany();
        await Availability.deleteMany();
        await Appointment.deleteMany();

        
        console.log('Creating users...');
        const professor = new User({ username: 'P1', password: 'pass', role: 'professor' });
        const student1 = new User({ username: 'A1', password: 'pass', role: 'student' });
        const student2 = new User({ username: 'A2', password: 'pass', role: 'student' });

        await professor.save();
        await student1.save();
        await student2.save();

        console.log('Users created successfully!');
    } catch (err) {
        console.error('Error during initialization:', err);
    } 
})();



const authenticate = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1]; 
    console.log('Token received:', token);  

    if (!token) return res.status(401).send('Access denied: No token provided.');

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        console.log('Decoded token:', decoded);  
        req.user = decoded; // 
        next();
    } catch (err) {
        console.log('Token verification failed:', err);  
        return res.status(403).send('Invalid token');
    }
};


// Routes

// User Authentication
app.post('/auth', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (!user) return res.status(401).send('Invalid credentials');

    const token = jwt.sign({ id: user._id, role: user.role }, SECRET_KEY);
    res.send({ token });
});

// Professor specifies availability
app.post('/availability', authenticate, async (req, res) => {
    if (req.user.role !== 'professor') return res.status(403).send('Forbidden');

    const { slots } = req.body;
    const availability = await Availability.findOneAndUpdate(
        { professorId: req.user.id },
        { professorId: req.user.id, slots },
        { upsert: true, new: true }
    );
    res.send(availability);
});

// Student views available slots
app.get('/availability/:professorId', authenticate, async (req, res) => {
    if (req.user.role !== 'student') return res.status(403).send('Forbidden');

    const availability = await Availability.findOne({ professorId: req.params.professorId });
    if (!availability) return res.status(404).send('No availability found');
    res.send(availability.slots);
});

// Student books appointment
app.post('/appointments', authenticate, async (req, res) => {
    if (req.user.role !== 'student') return res.status(403).send('Forbidden');

    const { professorId, time } = req.body;
    const availability = await Availability.findOne({ professorId });
    if (!availability || !availability.slots.includes(time)) {
        return res.status(400).send('Slot not available');
    }

    // Remove booked slot
    availability.slots = availability.slots.filter(slot => slot !== time);
    await availability.save();

    const appointment = new Appointment({
        professorId,
        studentId: req.user.id,
        time,
    });
    await appointment.save();

    res.send(appointment);
});


// Professor cancels an appointment
app.delete('/appointments/:appointmentId', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'professor') {
            return res.status(403).json({ error: 'Only professors can cancel appointments' });
        }

        const appointmentId = req.params.appointmentId;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        if (appointment.professorId.toString() !== req.user.id) {
            return res.status(403).json({ error: 'You can only cancel your own appointments' });
        }

        await Appointment.deleteOne({ _id: appointmentId });

        const availability = await Availability.findOne({ professorId: appointment.professorId });
        if (availability) {
            if (!availability.slots.includes(appointment.time)) {
                availability.slots.push(appointment.time); 
            }
            await availability.save();
        }

        return res.status(200).json({ message: 'Appointment canceled successfully' });
    } catch (error) {
        console.error('Error canceling appointment:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/appointments/student', authenticate, async (req, res) => {
    try {
        
        if (req.user.role !== 'student') {
            return res.status(403).json({ error: 'Only students can view their appointments' });
        }

        
        const studentAppointments = await Appointment.find({ studentId: req.user.id });

        if (studentAppointments.length === 0) {
            return res.status(200).json({ message: 'No pending appointments' });
        }

        return res.status(200).json(studentAppointments);
    } catch (error) {
        console.error('Error fetching student appointments:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});




app.listen(3000, () => console.log('Server running on port 3000'));

