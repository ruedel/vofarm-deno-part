
import { FinancialCalculator } from "./utilities/financial-calculator.ts"
import { InvestmentAdvice } from "./interfaces/investment-advice.ts"
import { InvestmentOption } from "./interfaces/investment-option.ts"
import { sleep } from "https://deno.land/x/sleep@v1.2.0/mod.ts"
import { Action } from "./interfaces/action.ts"
import { VoFarmStrategy } from "./interfaces/vofarm-strategy.ts"
import { VFLogger } from "./utilities/logger.ts";

export class LongETHStrategy implements VoFarmStrategy {

    private currentInvestmentAdvices: InvestmentAdvice[] = []
    private investmentOptions: InvestmentOption[] = []
    private lastAdviceDate: Date = new Date()
    private oPNLClosingLimit: number = 54

    public constructor(private logger?: VFLogger) {
        this.investmentOptions.push({ pair: "ETHUSDT", minTradingAmount: 0.01 })
    }

    public async getInvestmentAdvices(investmentDecisionBase: any): Promise<InvestmentAdvice[]> {


        let longShortDeltaInPercent = FinancialCalculator.getLongShortDeltaInPercent(investmentDecisionBase.positions, this.investmentOptions[0].pair)
        let liquidityLevel = (investmentDecisionBase.accountInfo.result.USDT.available_balance / investmentDecisionBase.accountInfo.result.USDT.equity) * 20

        let longPosition = investmentDecisionBase.positions.filter((p: any) => p.data.side === 'Buy' && p.data.symbol === this.investmentOptions[0].pair)[0]
        let shortPosition = investmentDecisionBase.positions.filter((p: any) => p.data.side === 'Sell' && p.data.symbol === this.investmentOptions[0].pair)[0]

        for (const investmentOption of this.investmentOptions) {
            for (const move of Object.values(Action)) {
                await sleep(0.1)
                await this.deriveInvestmentAdvice(investmentOption, move, investmentDecisionBase, longShortDeltaInPercent, liquidityLevel, longPosition, shortPosition)
            }

        }

        const advices: InvestmentAdvice[] = [...this.currentInvestmentAdvices]
        this.currentInvestmentAdvices = []

        return advices

    }

    public getInvestmentOptions(): InvestmentOption[] {
        return this.investmentOptions
    }


    protected getAddingPointLong(lsd: number, ll: number): number {

        let aPL = (lsd < 0) ?
            -11 :
            (Math.abs(lsd) * -4) - 11

        if (ll > 4) {
            if (this.isPreviousAdviceOlderThanXMinutes(3)) {
                aPL = aPL / ll
            } else if (this.isPreviousAdviceOlderThanXMinutes(1)) {
                aPL = aPL / (ll / 2)
            }
        }

        return aPL

    }


    protected getAddingPointShort(lsd: number, ll: number): number {

        let aPS = (lsd > 0) ?
            - 44 :
            (Math.abs(lsd) * -7) - 44

        if (ll > 4) {
            if (this.isPreviousAdviceOlderThanXMinutes(10)) {
                aPS = aPS / ll
            } else if (this.isPreviousAdviceOlderThanXMinutes(5)) {
                aPS = aPS / (ll / 2)
            }

        }

        return aPS

    }


    protected getClosingPointLong(lsd: number, ll: number): number {

        let cPL = (lsd > 0) ?
            142 :
            Math.abs(lsd) + 142

        if (ll < 1) {
            cPL = 0
        }

        return cPL

    }


    protected getClosingPointShort(lsd: number, ll: number): number {

        let cPS = (lsd < 0) ?
            56 :
            lsd + 56

        if (ll < 1) {
            cPS = 0
        }

        return cPS
    }

    protected isPreviousAdviceOlderThanXMinutes(minutes: number): boolean {

        const refDate = new Date()

        refDate.setMinutes(refDate.getMinutes() - minutes)

        if (this.lastAdviceDate < refDate) {
            const message = `lastAdviceDate :${this.lastAdviceDate} vs. refDate: ${refDate}`
            console.log(message)
            return true
        }

        return false
    }

    protected async deriveInvestmentAdvice(investmentOption: InvestmentOption, move: Action, investmentDecisionBase: any, lsd: number, ll: number, longP: any, shortP: any): Promise<void> {


        if (move === Action.PAUSE) { // here just to ensure the following block is executed only once

            this.deriveSpecialMoves(investmentOption, investmentDecisionBase, ll, longP, shortP)

        } else if (longP !== undefined && shortP !== undefined && this.currentInvestmentAdvices.length === 0) {

            await this.deriveStandardMoves(investmentOption, move, lsd, ll, longP, shortP)

        }

    }


    protected closeAll(investmentOption: InvestmentOption, specificmessage: string, longP: any, shortP: any): void {

        if (longP !== undefined) {

            this.addInvestmentAdvice(Action.REDUCELONG, Number((longP.data.size).toFixed(3)), investmentOption.pair, `we close ${longP.data.size} ${investmentOption.pair} long due to ${specificmessage}`)
        }

        if (shortP !== undefined) {

            this.addInvestmentAdvice(Action.REDUCESHORT, Number((shortP.data.size).toFixed(3)), investmentOption.pair, `we close ${shortP.data.size} ${investmentOption.pair} short due to ${specificmessage}`)

        }

    }


    protected addInvestmentAdvice(action: Action, amount: number, pair: string, reason: string): void {

        const investmentAdvice: InvestmentAdvice = {
            action,
            amount,
            pair,
            reason
        }

        this.currentInvestmentAdvices.push(investmentAdvice)

        this.lastAdviceDate = new Date()

    }

    protected checkSetup(investmentOption: InvestmentOption, longP: any, shortP: any): void {
        if (longP === undefined) {

            this.addInvestmentAdvice(Action.BUY, investmentOption.minTradingAmount, investmentOption.pair, `we open a ${investmentOption.pair} long position to play the game`)

        }

        if (shortP === undefined) {

            this.addInvestmentAdvice(Action.SELL, investmentOption.minTradingAmount, investmentOption.pair, `we open a ${investmentOption.pair} short position to play the game`)

        }
    }

    protected async deriveStandardMoves(investmentOption: InvestmentOption, move: Action, lsd: number, ll: number, longP: any, shortP: any): Promise<void> {

        switch (move) {

            case Action.BUY: {

                let pnlLong = FinancialCalculator.getPNLOfPositionInPercent(longP)

                let aPL = this.getAddingPointLong(lsd, ll)

                await this.log(`adding point long: ${aPL.toFixed(2)} (${pnlLong})`)

                if (pnlLong < aPL) {
                    let factor = Math.floor(Math.abs(lsd) / 10)
                    if (factor < 1) factor = 1
                    const amount = Number((investmentOption.minTradingAmount * factor).toFixed(3))
                    const reason = `we enhance our ${investmentOption.pair} long position (at a pnl of: ${pnlLong}%) by ${amount}`
                    this.addInvestmentAdvice(Action.BUY, amount, investmentOption.pair, reason)
                }

                break

            }

            case Action.SELL: {

                let pnlShort = FinancialCalculator.getPNLOfPositionInPercent(shortP)

                let aPS = this.getAddingPointShort(lsd, ll)

                await this.log(`adding point short: ${aPS.toFixed(2)} (${pnlShort})`)

                if (pnlShort < aPS) {

                    let factor = Math.floor(Math.abs(lsd) / 10)
                    if (factor < 1) factor = 1
                    const amount = Number((investmentOption.minTradingAmount * factor).toFixed(3))
                    const reason = `we enhance our ${investmentOption.pair} short position (at a pnl of: ${pnlShort}%) by ${amount}`
                    this.addInvestmentAdvice(Action.SELL, amount, investmentOption.pair, reason)
                }

                break
            }

            case Action.REDUCELONG: {

                let pnlLong = FinancialCalculator.getPNLOfPositionInPercent(longP)

                let cPL = this.getClosingPointLong(lsd, ll)

                await this.log(`closing point long: ${cPL.toFixed(2)} (${pnlLong})`)

                if (pnlLong > cPL && longP !== undefined && longP.data.size > investmentOption.minTradingAmount) {
                    const reason = `we reduce our ${investmentOption.pair} long position to realize ${pnlLong}% profits`
                    this.addInvestmentAdvice(Action.REDUCELONG, investmentOption.minTradingAmount, investmentOption.pair, reason)
                }

                break

            }

            case Action.REDUCESHORT: {

                let pnlShort = FinancialCalculator.getPNLOfPositionInPercent(shortP)

                let cPS = this.getClosingPointShort(lsd, ll)

                await this.log(`closing point short: ${cPS.toFixed(2)} (${pnlShort})`)

                if (pnlShort > cPS && shortP !== undefined && shortP.data.size > investmentOption.minTradingAmount) {
                    const reason = `we reduce our ${investmentOption.pair} short position to realize ${pnlShort}% profits`
                    this.addInvestmentAdvice(Action.REDUCESHORT, investmentOption.minTradingAmount, investmentOption.pair, reason)
                }

                break

            }

            default: throw new Error(`you detected an interesting situation`)

        }
    }

    protected deriveSpecialMoves(investmentOption: InvestmentOption, investmentDecisionBase: any, ll: number, longP: any, shortP: any): void {

        let overallPNL = 0
        try {
            overallPNL = FinancialCalculator.getOverallPNLInPercent(longP, shortP)
        } catch (error) {
            console.log(error.message)
        }

        this.oPNLClosingLimit = Math.round(Math.random() * (81 - 36) + 36)

        console.log(`overallPNL: ${overallPNL} vs. oPNLClosingLimit: ${this.oPNLClosingLimit} vs. liquidityLevel: ${ll}`)

        this.checkSetup(investmentOption, longP, shortP)

    }

    protected async log(message: string) {
        if (this.logger !== undefined) {
            await this.logger.log(message)
        }
    }
}

