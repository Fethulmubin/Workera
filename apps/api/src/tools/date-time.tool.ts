import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { toEC, toGC, diffBreakdown, monthNames } from 'kenat';
import type { ToolContext, ToolDefinition } from './types/tool.types';

const dateTimeInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('now'),
    calendar: z.enum(['gregorian', 'ethiopian']).default('gregorian'),
    timezone: z.string().default('Africa/Addis_Ababa'),
  }),

  z.object({
    action: z.literal('convert'),
    fromCalendar: z.enum(['gregorian', 'ethiopian']),
    toCalendar: z.enum(['gregorian', 'ethiopian']),
    date: z.string(),
  }),

  z.object({
    action: z.literal('add'),
    calendar: z.enum(['gregorian', 'ethiopian']),
    date: z.string(),
    amount: z.number().int(),
    unit: z.enum(['days', 'months', 'years']),
  }),

  z.object({
    action: z.literal('difference'),
    calendar: z.enum(['gregorian', 'ethiopian']),
    startDate: z.string(),
    endDate: z.string(),
    unit: z.enum(['days', 'months', 'years', 'breakdown']),
  }),

  z.object({
    action: z.literal('info'),
    calendar: z.enum(['gregorian', 'ethiopian']),
    date: z.string(),
  }),
]);

type DateTimeInput = z.infer<typeof dateTimeInputSchema>;

interface DateTimeOutput {
  action: DateTimeInput['action'];
  [key: string]: unknown;
}

@Injectable()
export class DateTimeTool
  implements ToolDefinition<DateTimeInput, DateTimeOutput>
{
  name = 'date_time';

  description =
    'Handles Gregorian and Ethiopian calendar dates, date conversion, date arithmetic, date differences, Ethiopian month information, and the current date/time. Use this tool for Ethiopian calendar calculations instead of calculating dates yourself.';

  inputSchema = dateTimeInputSchema;

  async execute(
    input: DateTimeInput,
    _context: ToolContext,
  ): Promise<DateTimeOutput> {
    switch (input.action) {
      case 'now':
        return this.getNow(input);

      case 'convert':
        return this.convert(input);

      case 'add':
        return this.add(input);

      case 'difference':
        return this.difference(input);

      case 'info':
        return this.info(input);
    }
  }

  private getNow(
    input: Extract<DateTimeInput, { action: 'now' }>,
  ): DateTimeOutput {
    const now = new Date();

    const iso = now.toISOString();

    if (input.calendar === 'gregorian') {
      const parts = this.getDatePartsInTimezone(now, input.timezone);

      return {
        action: 'now',
        calendar: 'gregorian',
        timezone: input.timezone,
        date: this.formatDate(parts.year, parts.month, parts.day),
        year: parts.year,
        month: parts.month,
        day: parts.day,
        time: `${this.pad(parts.hour)}:${this.pad(parts.minute)}:${this.pad(parts.second)}`,
        iso,
      };
    }

    const parts = this.getDatePartsInTimezone(now, input.timezone);
    const ethiopian = toEC(parts.year, parts.month, parts.day);

    return {
      action: 'now',
      calendar: 'ethiopian',
      timezone: input.timezone,
      date: this.formatDate(
        ethiopian.year,
        ethiopian.month,
        ethiopian.day,
      ),
      year: ethiopian.year,
      month: ethiopian.month,
      monthName: monthNames.english[ethiopian.month - 1],
      monthNameAmharic: monthNames.amharic[ethiopian.month - 1],
      day: ethiopian.day,
      time: `${this.pad(parts.hour)}:${this.pad(parts.minute)}:${this.pad(parts.second)}`,
      iso,
    };
  }

  private convert(
    input: Extract<DateTimeInput, { action: 'convert' }>,
  ): DateTimeOutput {
    if (input.fromCalendar === input.toCalendar) {
      const date = this.parseDate(input.date);

      if (input.fromCalendar === 'ethiopian') {
        this.validateEthiopianDate(date.year, date.month, date.day);
      } else {
        this.validateGregorianDate(date.year, date.month, date.day);
      }

      return {
        action: 'convert',
        fromCalendar: input.fromCalendar,
        toCalendar: input.toCalendar,
        inputDate: input.date,
        date: input.date,
      };
    }

    const date = this.parseDate(input.date);

    if (
      input.fromCalendar === 'gregorian' &&
      input.toCalendar === 'ethiopian'
    ) {
      this.validateGregorianDate(date.year, date.month, date.day);

      const result = toEC(date.year, date.month, date.day);

      return {
        action: 'convert',
        fromCalendar: 'gregorian',
        toCalendar: 'ethiopian',
        inputDate: input.date,
        date: this.formatDate(result.year, result.month, result.day),
        year: result.year,
        month: result.month,
        monthName: monthNames.english[result.month - 1],
        monthNameAmharic: monthNames.amharic[result.month - 1],
        day: result.day,
      };
    }

    this.validateEthiopianDate(date.year, date.month, date.day);

    const result = toGC(date.year, date.month, date.day);

    return {
      action: 'convert',
      fromCalendar: 'ethiopian',
      toCalendar: 'gregorian',
      inputDate: input.date,
      date: this.formatDate(result.year, result.month, result.day),
      year: result.year,
      month: result.month,
      day: result.day,
    };
  }

  private add(
    input: Extract<DateTimeInput, { action: 'add' }>,
  ): DateTimeOutput {
    const date = this.parseDate(input.date);

    if (input.calendar === 'gregorian') {
      this.validateGregorianDate(date.year, date.month, date.day);

      const jsDate = new Date(
        Date.UTC(date.year, date.month - 1, date.day),
      );

      if (input.unit === 'days') {
        jsDate.setUTCDate(jsDate.getUTCDate() + input.amount);
      } else if (input.unit === 'months') {
        jsDate.setUTCMonth(jsDate.getUTCMonth() + input.amount);
      } else {
        jsDate.setUTCFullYear(
          jsDate.getUTCFullYear() + input.amount,
        );
      }

      const result = {
        year: jsDate.getUTCFullYear(),
        month: jsDate.getUTCMonth() + 1,
        day: jsDate.getUTCDate(),
      };

      return {
        action: 'add',
        calendar: 'gregorian',
        inputDate: input.date,
        amount: input.amount,
        unit: input.unit,
        date: this.formatDate(result.year, result.month, result.day),
        ...result,
      };
    }

    this.validateEthiopianDate(date.year, date.month, date.day);

    // Convert Ethiopian → Gregorian.
    const gregorian = toGC(date.year, date.month, date.day);

    const jsDate = new Date(
      Date.UTC(
        gregorian.year,
        gregorian.month - 1,
        gregorian.day,
      ),
    );

    if (input.unit === 'days') {
      jsDate.setUTCDate(jsDate.getUTCDate() + input.amount);
    } else if (input.unit === 'months') {
      jsDate.setUTCMonth(jsDate.getUTCMonth() + input.amount);
    } else {
      jsDate.setUTCFullYear(
        jsDate.getUTCFullYear() + input.amount,
      );
    }

    const result = toEC(
      jsDate.getUTCFullYear(),
      jsDate.getUTCMonth() + 1,
      jsDate.getUTCDate(),
    );

    return {
      action: 'add',
      calendar: 'ethiopian',
      inputDate: input.date,
      amount: input.amount,
      unit: input.unit,
      date: this.formatDate(result.year, result.month, result.day),
      year: result.year,
      month: result.month,
      monthName: monthNames.english[result.month - 1],
      monthNameAmharic: monthNames.amharic[result.month - 1],
      day: result.day,
    };
  }

  private difference(
    input: Extract<DateTimeInput, { action: 'difference' }>,
  ): DateTimeOutput {
    const start = this.parseDate(input.startDate);
    const end = this.parseDate(input.endDate);

    if (input.calendar === 'ethiopian') {
      this.validateEthiopianDate(start.year, start.month, start.day);
      this.validateEthiopianDate(end.year, end.month, end.day);

      const result = diffBreakdown(start, end);

      if (input.unit === 'breakdown') {
        return {
          action: 'difference',
          calendar: 'ethiopian',
          startDate: input.startDate,
          endDate: input.endDate,
          ...result,
        };
      }

      return {
        action: 'difference',
        calendar: 'ethiopian',
        startDate: input.startDate,
        endDate: input.endDate,
        unit: input.unit,
        value:
          input.unit === 'days'
            ? result.totalDays
            : input.unit === 'months'
              ? result.months
              : result.years,
        sign: result.sign,
      };
    }

    this.validateGregorianDate(start.year, start.month, start.day);
    this.validateGregorianDate(end.year, end.month, end.day);

    const startDate = Date.UTC(
      start.year,
      start.month - 1,
      start.day,
    );

    const endDate = Date.UTC(
      end.year,
      end.month - 1,
      end.day,
    );

    const totalDays = Math.abs(
      Math.round((endDate - startDate) / 86_400_000),
    );

    const sign = endDate >= startDate ? 1 : -1;

    return {
      action: 'difference',
      calendar: 'gregorian',
      startDate: input.startDate,
      endDate: input.endDate,
      unit: input.unit,
      value:
        input.unit === 'days'
          ? totalDays
          : input.unit === 'months'
            ? this.calculateGregorianMonths(start, end)
            : this.calculateGregorianYears(start, end),
      totalDays,
      sign,
    };
  }

  private info(
    input: Extract<DateTimeInput, { action: 'info' }>,
  ): DateTimeOutput {
    const date = this.parseDate(input.date);

    if (input.calendar === 'ethiopian') {
      this.validateEthiopianDate(date.year, date.month, date.day);

      const isPagume = date.month === 13;

      return {
        action: 'info',
        calendar: 'ethiopian',
        date: input.date,
        year: date.year,
        month: date.month,
        monthName: monthNames.english[date.month - 1],
        monthNameAmharic: monthNames.amharic[date.month - 1],
        day: date.day,
        isPagume,
        daysInMonth: isPagume
          ? this.isEthiopianLeapYear(date.year)
            ? 6
            : 5
          : 30,
        isLeapYear: this.isEthiopianLeapYear(date.year),
      };
    }

    this.validateGregorianDate(date.year, date.month, date.day);

    const jsDate = new Date(
      Date.UTC(date.year, date.month - 1, date.day),
    );

    return {
      action: 'info',
      calendar: 'gregorian',
      date: input.date,
      year: date.year,
      month: date.month,
      monthName: monthNames.gregorian[date.month - 1],
      day: date.day,
      dayOfWeek: jsDate.toLocaleDateString('en-US', {
        weekday: 'long',
        timeZone: 'UTC',
      }),
      isLeapYear: this.isGregorianLeapYear(date.year),
      daysInMonth: new Date(
        Date.UTC(date.year, date.month, 0),
      ).getUTCDate(),
    };
  }

  private parseDate(value: string): {
    year: number;
    month: number;
    day: number;
  } {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    if (!match) {
      throw new Error(
        `Invalid date "${value}". Expected YYYY-MM-DD.`,
      );
    }

    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
  }

  private validateGregorianDate(
    year: number,
    month: number,
    day: number,
  ): void {
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new Error(
        `Invalid Gregorian date: ${this.formatDate(year, month, day)}`,
      );
    }
  }

  private validateEthiopianDate(
    year: number,
    month: number,
    day: number,
  ): void {
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      month < 1 ||
      month > 13 ||
      day < 1
    ) {
      throw new Error(
        `Invalid Ethiopian date: ${this.formatDate(year, month, day)}`,
      );
    }

    const maxDay =
      month === 13
        ? this.isEthiopianLeapYear(year)
          ? 6
          : 5
        : 30;

    if (day > maxDay) {
      throw new Error(
        `Invalid Ethiopian date: ${this.formatDate(year, month, day)}`,
      );
    }

    // Let Kenat perform the final validation.
    toGC(year, month, day);
  }

  private isEthiopianLeapYear(year: number): boolean {
    return year % 4 === 3;
  }

  private isGregorianLeapYear(year: number): boolean {
    return (
      year % 400 === 0 ||
      (year % 4 === 0 && year % 100 !== 0)
    );
  }

  private calculateGregorianMonths(
    start: { year: number; month: number; day: number },
    end: { year: number; month: number; day: number },
  ): number {
    return Math.abs(
      (end.year - start.year) * 12 +
        (end.month - start.month),
    );
  }

  private calculateGregorianYears(
    start: { year: number; month: number; day: number },
    end: { year: number; month: number; day: number },
  ): number {
    return Math.abs(end.year - start.year);
  }

  private getDatePartsInTimezone(
    date: Date,
    timezone: string,
  ): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  } {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });

    const parts = formatter.formatToParts(date);

    const get = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value);

    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
      second: get('second'),
    };
  }

  private formatDate(
    year: number,
    month: number,
    day: number,
  ): string {
    return `${year.toString().padStart(4, '0')}-${month
      .toString()
      .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  }

  private pad(value: number): string {
    return value.toString().padStart(2, '0');
  }
}