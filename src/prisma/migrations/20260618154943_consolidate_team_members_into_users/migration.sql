/*
  Warnings:

  - You are about to drop the `team_members` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "team_members" DROP CONSTRAINT "team_members_tenant_id_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" VARCHAR(50) NOT NULL DEFAULT 'OPERATOR';

-- DropTable
DROP TABLE "team_members";
