using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using MusicTheory.API.Models.Entities;

namespace MusicTheory.API.Data;

public class MusicTheoryDbContext : IdentityDbContext<User, IdentityRole<Guid>, Guid>
{
    public MusicTheoryDbContext(DbContextOptions<MusicTheoryDbContext> options)
        : base(options)
    {
    }

    public DbSet<TeacherProfile> TeacherProfiles => Set<TeacherProfile>();
    public DbSet<StudentProfile> StudentProfiles => Set<StudentProfile>();
    public DbSet<Enrollment> Enrollments => Set<Enrollment>();
    public DbSet<Invitation> Invitations => Set<Invitation>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    /// <summary>
    /// What a detector observed, keyed by the audio's own bytes and shared
    /// between every user who uploads them.
    /// </summary>
    public DbSet<TranscriptionDetections> TranscriptionDetections =>
        Set<TranscriptionDetections>();

    /// <summary>One user's request to transcribe a file.</summary>
    public DbSet<TranscriptionJob> TranscriptionJobs => Set<TranscriptionJob>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<TranscriptionJob>(entity =>
        {
            // Every read of a job is "this user's jobs" or "this job, if it is
            // this user's", and the queue drains by status.
            entity.HasIndex(j => new { j.UserId, j.CreatedUtc });
            entity.HasIndex(j => j.ContentHash);

            // No foreign key to TranscriptionDetections on purpose: a job
            // exists from the moment it is queued, before there are any
            // detections to point at, and it outlives a failure that produces
            // none. The hash is the join and it is allowed to find nothing.
            entity.Property(j => j.ContentHash).IsRequired();
        });

        // User configuration
        builder.Entity<User>(entity =>
        {
            entity.HasOne(u => u.TeacherProfile)
                .WithOne(t => t.User)
                .HasForeignKey<TeacherProfile>(t => t.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(u => u.StudentProfile)
                .WithOne(s => s.User)
                .HasForeignKey<StudentProfile>(s => s.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // TeacherProfile configuration
        builder.Entity<TeacherProfile>(entity =>
        {
            entity.HasKey(t => t.Id);
            entity.HasIndex(t => t.UserId).IsUnique();
            entity.Property(t => t.HourlyRate).HasPrecision(10, 2);
        });

        // StudentProfile configuration
        builder.Entity<StudentProfile>(entity =>
        {
            entity.HasKey(s => s.Id);
            entity.HasIndex(s => s.UserId).IsUnique();
        });

        // Enrollment configuration
        builder.Entity<Enrollment>(entity =>
        {
            entity.HasKey(e => e.Id);

            entity.HasOne(e => e.Teacher)
                .WithMany(t => t.Students)
                .HasForeignKey(e => e.TeacherId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Student)
                .WithMany(s => s.Enrollments)
                .HasForeignKey(e => e.StudentId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => new { e.TeacherId, e.StudentId }).IsUnique();
        });

        // Invitation configuration
        builder.Entity<Invitation>(entity =>
        {
            entity.HasKey(i => i.Id);
            entity.HasIndex(i => i.Code).IsUnique();
            entity.HasIndex(i => new { i.TeacherId, i.Email });

            entity.HasOne(i => i.Teacher)
                .WithMany(t => t.Invitations)
                .HasForeignKey(i => i.TeacherId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // RefreshToken configuration
        builder.Entity<RefreshToken>(entity =>
        {
            entity.HasKey(r => r.Id);
            entity.HasIndex(r => r.Token).IsUnique();
            entity.HasIndex(r => r.UserId);

            entity.HasOne(r => r.User)
                .WithMany()
                .HasForeignKey(r => r.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
