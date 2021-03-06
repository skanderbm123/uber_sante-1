const moment = require('moment');
const persist = require('../persistence');
const Clinics = require('./Clinics');
const Doctors = require('./Doctors')

class Appointment {
    constructor() {
        this.result = { made: true, message: [] };
    }




    static async getAppointments({ appointmentId, patientId, doctorId, clinicId, date, blockIds, start, end }) {

        const query = {}

        if (date) {
            query.date = date
        }

        if (appointmentId) {
            query._id = ObjectId(appointmentId)
        }

        if (blockIds) {
            if (blockIds.length == 3) {
                query.blockIds = blockIds
            } else if (blockIds.length == 1) {
                query.blockIds = { $in: [...blockIds] }
            }

        }

        if (clinicId) {
            query.clinicId = clinicId
        }
        if (patientId) {
            query.patientId = patientId
        }
        if (doctorId) {
            query["doctor._id"] = ObjectId(doctorId);
        }
        const appointments = await persist(async (db) => {
            const appointments = await db.collection("appointments").find(query).toArray()
            return appointments
        });

        let filteredAppointments = []
        let appointment
        let aptDate;
        if (start || end) {

            const startMoment = moment(start);
            const endMoment = moment(end);

            for (let i = 0; i < appointments.length; i++) {

                appointment = appointments[i]
                aptDate = moment(appointment.date)
                if (startMoment.isValid() && endMoment.isValid() && start != undefined && end != undefined) {
                    if (startMoment.isBefore(aptDate) && endMoment.isAfter(aptDate)) filteredAppointments.push(appointment)
                } else if (startMoment.isValid() && start != undefined) {
                    if (startMoment.isBefore(aptDate)) filteredAppointments.push(appointment)
                } else if (endMoment.isValid() && end != undefined) {
                    if (endMoment.isBefore(aptDate)) filteredAppointments.push(appointment)
                } else {
                    throw new Error("Start and End date are invalid")
                }
            }
        } else {
            filteredAppointments = appointments
        }
        return filteredAppointments
    }

    static async patientHasAnnual(patientId) {
        const query = {
            patientId,
            blockIds: { $size: 3 }
        }
        const patientAppointments = await persist(async (db) => {
            const patientAppointments = await db.collection("appointments").find(query).toArray();
            return patientAppointments;
        });
        return patientAppointments.length > 1
    }

    static async delete(appointmentId) {
        const result = await persist(async (db) => {
            return await db.collection("appointments").deleteOne({
                _id: ObjectId(appointmentId)
            })
        })
        console.log({result})
        if (result.result.n == 1) {
            return result
        }

        throw new Error("Was not able to delete the appointment")
    }




    static Builder() {
        class Builder {
            constructor() {
                this.appointment = new Appointment();
                return this;
            }

            async buildAppointmentTime({ blockIds, date }) {
                let isWithin = moment().add(4, 'w').isAfter(moment(date));
                let isTodayOrLater = moment(date).add(1, 'd').isAfter(moment(), 'day');
                if (!isWithin) {
                    this.appointment.result.made = false;
                    this.appointment.result.message.push("Date is not within now and 4 weeks. " + date)
                }

                if (!isTodayOrLater) {
                    this.appointment.result.made = false;
                    this.appointment.result.message.push("Date is before today. " + date);
                }
                if (blockIds.length == 1 && blockIds[0] <= 35 && blockIds >= 0) {
                    this.appointment.type = "walkin";
                } else if (blockIds.length == 3) {
                    this.appointment.type = "annual";
                    let hasAnnual = await Appointment.patientHasAnnual(this.appointment.patientId)
                    if (hasAnnual) {
                        this.appointment.result.made = false;
                        this.appointment.result.message.push("Already has annual appointment.")
                    }

                }

                date = moment(date);
                if (!date.isValid()) {
                    throw new Error("Date is not valid moment format. Provide '1995-12-25'");
                }

                this.appointment.blockIds = blockIds;
                this.appointment.date = date.format('YYYY-MM-DD')
                return this;
            }


            buildPatientInfo({ patientId, clinicId }) {
                if (patientId == undefined || clinicId == undefined) {
                    this.appointment.result.made = false;
                    this.appointment.result.message.push("Invalid Patient/Clinic Info.");
                }
                this.appointment.patientId = patientId;
                this.appointment.clinicId = clinicId;
                return this;
            }

            static noClinicRooms(clinicId) {
                return 5;
            }

            async assignDoctor() {
                const doctorQuery = {
                    blockIds: this.appointment.blockIds,
                    date: this.appointment.date,
                    clinicId: this.appointment.clinicId
                }


                const doctors = await Doctors.getDoctors(doctorQuery);

                const appointmentQuery = {
                    blockIds: this.appointment.blockIds,
                    date: moment(this.appointment.date).format('YYYY-MM-DD')
                }

                const appointments = await Appointment.getAppointments(appointmentQuery);


                let doctorId;
                for (let i = 0; i < appointments.length; i++) {
                    doctorId = appointments[i].doctor._id;
                    for (let j = 0; j < doctors.length; j++) {
                        if (doctorId.toString() == doctors[j]._id.toString()) {
                            doctors.splice(j, 1);
                        }
                    }
                }
                if (doctors.length == 0) {
                    this.appointment.result.made = false;
                    this.appointment.result.message.push("No available doctors.")
                }


                // choose a random doctor
                const luckyDoctor = doctors[Math.floor(Math.random() * doctors.length)];

                this.appointment.doctor = luckyDoctor;


                return this;
            }

            async assignRoom() {
                const query = {
                    blockIds: this.appointment.blockIds,
                    date: moment(this.appointment.date).format('YYYY-MM-DD')
                }

                const appointments = await Appointment.getAppointments(query)
                const clinic = await Clinics.get(this.appointment.clinicId);

                let availableRooms = new Set(clinic.rooms)

                // diff the allRooms and taken rooms to yield available rooms
                for (let i = 0; i < appointments.length; i++) {
                    availableRooms.delete(appointments[i].room);
                }


                availableRooms = Array.from(availableRooms);

                if (availableRooms.length > 0) this.appointment.room = availableRooms[0];
                else {
                    this.appointment.room = null;
                    this.appointment.result.made = false;
                    this.appointment.result.message.push("No rooms available.");
                }

                return this;
            }

            async buildAppointment() {
                if (!this.appointment.result.made) {
                    throw new Error(this.appointment.result.message);
                }
                const appointment = await persist(async (db) => {
                    return await db.collection("appointments").insertOne(this.appointment);
                });
                this.appointment._id = appointment.ops[0]._id;
                return this.appointment;
            }
        }
        return new Builder();
    }



}

module.exports = Appointment;
