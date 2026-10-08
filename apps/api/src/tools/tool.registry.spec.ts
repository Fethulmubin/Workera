import { DateTimeTool } from './date-time.tool';

describe('DateTimeTool', () => {
  const tool = new DateTimeTool();

  const context = {
    organizationId: 'org-1',
    agentId: 'agent-1',
    userId: 'user-1',
  };

  describe('convert', () => {
    it('converts Gregorian to Ethiopian', async () => {
      const result = await tool.execute(
        {
          action: 'convert',
          fromCalendar: 'gregorian',
          toCalendar: 'ethiopian',
          date: '2026-10-07',
        },
        context,
      );

      expect(result).toMatchObject({
        action: 'convert',
        date: '2019-01-27',
        year: 2019,
        month: 1,
        day: 27,
        monthName: 'Meskerem',
      });
    });

    it('converts Ethiopian to Gregorian', async () => {
      const result = await tool.execute(
        {
          action: 'convert',
          fromCalendar: 'ethiopian',
          toCalendar: 'gregorian',
          date: '2019-01-01',
        },
        context,
      );

      expect(result).toMatchObject({
        action: 'convert',
        date: '2026-09-11',
        year: 2026,
        month: 9,
        day: 11,
      });
    });
  });

  describe('info', () => {
    it('identifies Pagume', async () => {
      const result = await tool.execute(
        {
          action: 'info',
          calendar: 'ethiopian',
          date: '2018-13-05',
        },
        context,
      );

      expect(result).toMatchObject({
        action: 'info',
        calendar: 'ethiopian',
        month: 13,
        monthName: 'Pagume',
        isPagume: true,
        daysInMonth: 5,
      });
    });

    it('recognizes the Ethiopian leap year', async () => {
      const result = await tool.execute(
        {
          action: 'info',
          calendar: 'ethiopian',
          date: '2015-13-06',
        },
        context,
      );

      expect(result).toMatchObject({
        calendar: 'ethiopian',
        month: 13,
        day: 6,
        isPagume: true,
        daysInMonth: 6,
        isLeapYear: true,
      });
    });
  });

  describe('add', () => {
    it('adds days to an Ethiopian date', async () => {
      const result = await tool.execute(
        {
          action: 'add',
          calendar: 'ethiopian',
          date: '2019-01-01',
          amount: 20,
          unit: 'days',
        },
        context,
      );

      expect(result).toMatchObject({
        action: 'add',
        calendar: 'ethiopian',
        date: '2019-01-21',
      });
    });

    it('handles adding days across Ethiopian New Year', async () => {
      const result = await tool.execute(
        {
          action: 'add',
          calendar: 'ethiopian',
          date: '2019-12-30',
          amount: 1,
          unit: 'days',
        },
        context,
      );

      expect(result).toMatchObject({
        date: '2019-13-01',
      });
    });
  });

  describe('difference', () => {
    it('calculates Ethiopian day difference', async () => {
      const result = await tool.execute(
        {
          action: 'difference',
          calendar: 'ethiopian',
          startDate: '2019-01-01',
          endDate: '2019-01-10',
          unit: 'days',
        },
        context,
      );

      expect(result).toMatchObject({
        action: 'difference',
        calendar: 'ethiopian',
        value: 9,
      });
    });

    it('returns an Ethiopian date breakdown', async () => {
      const result = await tool.execute(
        {
          action: 'difference',
          calendar: 'ethiopian',
          startDate: '2019-01-01',
          endDate: '2019-02-01',
          unit: 'breakdown',
        },
        context,
      );

      expect(result).toMatchObject({
        action: 'difference',
        calendar: 'ethiopian',
        totalDays: 30,
        years: 0,
        months: 1,
        days: 0,
      });
    });
  });
});