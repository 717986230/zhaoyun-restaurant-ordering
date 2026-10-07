import { BookingPage } from "./BookingPage";
import type { BookingLanguage } from "./booking-i18n";
import "./booking.css";

/**
 * Booking a table over the menu: loaded only when a guest taps the calendar,
 * so the menu itself carries none of it (nor its stylesheet).
 */
export default function BookingSheet({ language, onClose }: { language: BookingLanguage; onClose: () => void }) {
  return <BookingPage language={language} onClose={onClose} />;
}
