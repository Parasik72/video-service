import { forwardRef, HttpException, Inject, Injectable } from '@nestjs/common';
import { Ban, Prisma, User } from 'prisma/PostgreSQL/generated/client';
import { BansService } from '../bans/bans.service';
import { PostgreSQLPrismaService } from '../db/postgreSQL.prisma.service';
import { LogsService } from '../logs/logs.service';
import { RolesService } from '../roles/roles.service';
import { RoleTypes } from '../roles/roles.type';
import { v4 } from "uuid";
import { ISelectUser, SecuredUser, SelectFullUser } from './users.type';
import { ChangePassDto } from './dto/change-pass.dto';
import * as bcrypt from 'bcryptjs';
import { Request } from 'express';

@Injectable()
export class UsersService {
    constructor(private postgreSQLService: PostgreSQLPrismaService,
                @Inject(forwardRef(() => RolesService)) private rolesService: RolesService,
                private logsService: LogsService,
                @Inject(forwardRef(() => BansService)) private bansService: BansService){}

    async createUser(dto: Prisma.UserUncheckedCreateInput): Promise<User | null> {
        const role = await this.rolesService.getRoleByValue(RoleTypes.SUBSCRIBER);
        if(!role)
            return null;
        return this.postgreSQLService.user.create({
            data: {
                ...dto,
                roleId: role.id
            }
        });
    }

    async getOneByEmail(email: string): Promise<User | null> {
        return this.postgreSQLService.user.findFirst({ where: { email }});
    }

    async getOneById(id: string, select: ISelectUser): Promise<SecuredUser> {
        return this.postgreSQLService.user.findFirst({ where: { id }, select});
    }

    async getAll(req: Request): Promise<SecuredUser[]>{
        const userReq = req.user as Express.User;
        const user = await this.postgreSQLService.user.findUnique({where: {id: userReq.id}});
        if(!user)
            throw new HttpException('The user was not found.', 404);
        await this.logsService.create({operation: 'Get all the users', createdBy: user.id});
        return this.postgreSQLService.user.findMany({select: SelectFullUser});
    }

    async changePass(dto: ChangePassDto, req: Request){
        const userReq = req.user as Express.User;
        const user = await this.postgreSQLService.user.findUnique({where: {id: userReq.id}});
        if(!user)
            throw new HttpException('The user was not found.', 404);
        const comparePasswords = await bcrypt.compare(dto.oldPass, user.password);
        if(!comparePasswords)
            throw new HttpException('Incorrect data.', 400);
        const hashPassword = await bcrypt.hash(dto.newPass, 5);
        await this.updateUser({password: hashPassword}, user);
        await this.logsService.create({operation: 'Change the password', createdBy: user.id});
        return {message: 'The password has been changed successfully!'};
    }

    async updateUser(dto: Prisma.UserUncheckedUpdateInput, user: User | SecuredUser): Promise<User>{
        return this.postgreSQLService.user.update({data: dto, where: {id: user.id}});
    }

    async isBanned(user: User): Promise<Ban | null> {
        const bans = await this.bansService.getBansByUserId(user.id);
        if(bans.length <= 0)
            return null;
        const lastBan = bans[bans.length - 1];
        if(lastBan.unBannedAt)
            return null;
        return lastBan;
    }

    async generateUserId(): Promise<string>{
        let user: User | null, id: string;
        do {
            id = v4();
            user = await this.postgreSQLService.user.findUnique({where: {id}});
        } while (user);
        return id;
    }
}
