// Import necessary modules
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');
const app = express();

// Middleware setup
app.use(bodyParser.json());

// Constants
const SECRET_KEY = "secret";

// Database connection
mongoose.connect('mongodb+srv://suresh:Major123@cluster0.paov2.mongodb.net/AppointmentApi?retryWrites=true&w=majority&appName=Cluster0', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

console.log("Starting the application...");


// Schemas and Models
const userSchema = new mongoose.Schema({
    username: String,
    password: String,
    role: String, // 'student' or 'professor'
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

// Authentication Middleware
function authenticate(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).send('Access denied');

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(400).send('Invalid token');
    }
}

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

// Professor cancels appointment
app.delete('/appointments/:appointmentId', authenticate, async (req, res) => {
    if (req.user.role !== 'professor') return res.status(403).send('Forbidden');

    const appointment = await Appointment.findById(req.params.appointmentId);
    if (!appointment || appointment.professorId.toString() !== req.user.id) {
        return res.status(404).send('Appointment not found');
    }

    const availability = await Availability.findOne({ professorId: appointment.professorId });
    availability.slots.push(appointment.time);
    await availability.save();

    await appointment.deleteOne();
    res.send('Appointment canceled');
});

// Student views appointments
app.get('/appointments', authenticate, async (req, res) => {
    if (req.user.role !== 'student') return res.status(403).send('Forbidden');

    const appointments = await Appointment.find({ studentId: req.user.id });
    res.send(appointments);
});

// E2E Test Case
if (require.main === module) {
    (async () => {
        const server = app.listen(3000, () => console.log('Server running on port 3000'));

        try {
            // Clear database
            await User.deleteMany();
            await Availability.deleteMany();
            await Appointment.deleteMany();

            // Create users
            const professor = new User({ username: 'P1', password: 'pass', role: 'professor' });
            const student1 = new User({ username: 'A1', password: 'pass', role: 'student' });
            const student2 = new User({ username: 'A2', password: 'pass', role: 'student' });
            await professor.save();
            await student1.save();
            await student2.save();

            // Authenticate users
            const profToken = (await request(app).post('/auth').send({ username: 'P1', password: 'pass' })).body.token;
            const student1Token = (await request(app).post('/auth').send({ username: 'A1', password: 'pass' })).body.token;
            const student2Token = (await request(app).post('/auth').send({ username: 'A2', password: 'pass' })).body.token;

            // Professor specifies availability
            await request(app)
                .post('/availability')
                .set('Authorization', profToken)
                .send({ slots: ['T1', 'T2'] });

            // Student A1 views available slots
            const availableSlots = (await request(app)
                .get(`/availability/${professor._id}`)
                .set('Authorization', student1Token)).body;
            console.log('Available slots:', availableSlots);

            // Student A1 books an appointment
            const appointment1 = (await request(app)
                .post('/appointments')
                .set('Authorization', student1Token)
                .send({ professorId: professor._id, time: 'T1' })).body;
            console.log('Student A1 booked appointment:', appointment1);

            // Student A2 books an appointment
            const appointment2 = (await request(app)
                .post('/appointments')
                .set('Authorization', student2Token)
                .send({ professorId: professor._id, time: 'T2' })).body;
            console.log('Student A2 booked appointment:', appointment2);

            // Professor cancels appointment with Student A1
            await request(app)
                .delete(`/appointments/${appointment1._id}`)
                .set('Authorization', profToken);

            // Student A1 checks appointments
            const student1Appointments = (await request(app)
                .get('/appointments')
                .set('Authorization', student1Token)).body;

            console.log('Student A1 appointments after cancellation:', student1Appointments);
        } catch (err) {
            console.error(err);
        } finally {
            server.close();
            mongoose.connection.close();
        }
    })();
} else {
    module.exports = app;
}
